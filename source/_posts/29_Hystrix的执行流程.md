---
title: Hystrix的执行流程(去RxJava版)
date: 2020-03-01 15:52:39
tags:
categories:
- java
- springcloud
---

## 说明
- RxJava是一个并发编程的框架，和Hystrix的核心逻辑并没有直接的联系，RxJava的编码方式过于复杂，所以本次分析会尽量减少RxJava相关的代码
- Feign和Hystrix整合与单独使用Hystrix在执行逻辑上没有任何区别，所以今天分析的入口是`com.netflix.hystrix.HystrixCommand#execute`

## Hystrix的执行逻辑
- 任务提交
    ```java
    // com.netflix.hystrix.HystrixCommand#execute
    public R execute() {
        try {
            // 加到队列中并阻塞等待完成
            return queue().get();
        } catch (Exception e) {
            throw Exceptions.sneakyThrow(decomposeException(e));
        }
    }
    // com.netflix.hystrix.HystrixCommand#queue
    public Future<R> queue() {
        // toObservable 是RxJava的东西 实际的执行逻辑就封装在里面
        // toBlocking 包装成阻塞模式
        // toFuture 包装成Future 并且并且订阅 Observable 执行真正的Hystrix逻辑
        final Future<R> delegate = toObservable().toBlocking().toFuture();
        final Future<R> f = new Future<R>() {
            //... 简单包装了一下delegate
        }
        return f;
    }
    //rx.internal.operators.BlockingOperatorToFuture#toFuture
    public static <T> Future<T> toFuture(Observable<? extends T> that) {

        // 等待结果返回 唤醒
        final CountDownLatch finished = new CountDownLatch(1);
        // 结果
        final AtomicReference<T> value = new AtomicReference<T>();
        // 返回错误
        final AtomicReference<Throwable> error = new AtomicReference<Throwable>();

        // 订阅Observable  使其执行内部封装的真正逻辑
        @SuppressWarnings("unchecked")
        final Subscription s = ((Observable<T>)that).single().subscribe(new Subscriber<T>() {

            @Override
            public void onCompleted() {
                // 完成之后唤醒主线程
                finished.countDown();
            }

            @Override
            public void onError(Throwable e) {
                error.compareAndSet(null, e);
                finished.countDown();
            }

            // 返回结果后 将一个
            @Override
            public void onNext(T v) {
                // "single" guarantees there is only one "onNext"
                value.set(v);
            }
        });

        return new Future<T>() {

            private volatile boolean cancelled;

            // 取消执行
            @Override
            public boolean cancel(boolean mayInterruptIfRunning) {
                if (finished.getCount() > 0) {
                    cancelled = true;
                    // 取消正在执行的Observable
                    s.unsubscribe();
                    // release the latch (a race condition may have already released it by now)
                    finished.countDown();
                    return true;
                } else {
                    // can't cancel
                    return false;
                }
            }
            //...
            @Override
            public T get() throws InterruptedException, ExecutionException {
                // 等待结果返回
                finished.await();
                return getValue();
            }

            private T getValue() throws ExecutionException {
                final Throwable throwable = error.get();

                if (throwable != null) {
                    throw new ExecutionException("Observable onError", throwable);
                } else if (cancelled) {
                    // Contract of Future.get() requires us to throw this:
                    throw new CancellationException("Subscription unsubscribed");
                } else {
                    return value.get();
                }
            }
        };
    }
    ```
- Hystrix开始执行
    ```java
    //com.netflix.hystrix.AbstractCommand#toObservable
    //...
    // 设置一些回调
    // 这里是之前执行的代码 返回的Observable
    // 现在调用到它的call方法了
    return Observable.defer(new Func0<Observable<R>>() {
        @Override
        public Observable<R> call() {
            // 状态不对直接返回
            if (!commandState.compareAndSet(CommandState.NOT_STARTED, CommandState.OBSERVABLE_CHAIN_CREATED)) {
                IllegalStateException ex = new IllegalStateException("This instance can only be executed once. Please instantiate a new instance.");
                throw new HystrixRuntimeException(FailureType.BAD_REQUEST_EXCEPTION, _cmd.getClass(), getLogMessagePrefix() + " command executed multiple times - this is not permitted.", ex, null);
            }
            commandStartTimestamp = System.currentTimeMillis();
            //...
            // 这里是执行的核心逻辑 
            // 先声声明 稍后回调
            final Func0<Observable<R>> applyHystrixSemantics = new Func0<Observable<R>>() {
                @Override
                public Observable<R> call() {
                    if (commandState.get().equals(CommandState.UNSUBSCRIBED)) {
                        return Observable.never();
                    }
                    // 核心逻辑
                    return applyHystrixSemantics(_cmd);
                }
            };
            // 是否开启请求缓存 默认是关闭的 一般也不会开启 没什么意义
            final boolean requestCacheEnabled = isRequestCachingEnabled();
            //applyHystrixSemantics 
            Observable<R> hystrixObservable =
                    Observable.defer(applyHystrixSemantics)
                            .map(wrapWithAllOnNextHooks);

            Observable<R> afterCache;
            //...
            // 去掉一些缓存相关的逻辑
            // ...
            afterCache = hystrixObservable;
            
            // 执行核心逻辑
            return afterCache
                    .doOnTerminate(terminateCommandCleanup)     // perform cleanup once (either on normal terminal state (this line), or unsubscribe (next line))
                    .doOnUnsubscribe(unsubscribeCommandCleanup) // perform cleanup once
                    .doOnCompleted(fireOnCompletedHook);
        }
    });
    ```

- 断路器判断
    ```java
    //com.netflix.hystrix.AbstractCommand#applyHystrixSemantics
    private Observable<R> applyHystrixSemantics(final AbstractCommand<R> _cmd) {
        // mark that we're starting execution on the ExecutionHook
        // if this hook throws an exception, then a fast-fail occurs with no fallback.  No state is left inconsistent
        executionHook.onStart(_cmd);

        /* determine if we're allowed to execute */
        // 这里是判断断路器逻辑 下面分析
        if (circuitBreaker.allowRequest()) {
            // 省略一堆信号量逻辑 因为一般不会用
            //..
            return executeCommandAndObserve(_cmd)
                        .doOnError(markExceptionThrown)
                        .doOnTerminate(singleSemaphoreRelease)
                        .doOnUnsubscribe(singleSemaphoreRelease);
            } catch (RuntimeException e) {
                return Observable.error(e);
            }
        } else {
            // 走断路降级逻辑
            return handleShortCircuitViaFallback();
        }
    }
    //com.netflix.hystrix.HystrixCircuitBreaker.HystrixCircuitBreakerImpl#allowRequest
    // 请注意这里的 Open=断路器开启=不能通过 Close相反
    public boolean allowRequest() {
        // 断路器强制开启 直接失败
        if (properties.circuitBreakerForceOpen().get()) {
            // properties have asked us to force the circuit open so we will allow NO requests
            return false;
        }
        // 断路器强制关闭 直接成功
        if (properties.circuitBreakerForceClosed().get()) {
            // we still want to allow isOpen() to perform it's calculations so we simulate normal behavior
            isOpen();
            // properties have asked us to ignore errors so we will ignore the results of isOpen and just allow all traffic through
            return true;
        }
        // 这里才是最常用的逻辑 
        // 没开启 || 半开
        return !isOpen() || allowSingleTest();
    }
    //com.netflix.hystrix.HystrixCircuitBreaker.HystrixCircuitBreakerImpl#isOpen
    public boolean isOpen() {
            // 如果已经开启了 直接返回开启
            if (circuitOpen.get()) {
                // if we're open we immediately return true and don't bother attempting to 'close' ourself as that is left to allowSingleTest and a subsequent successful test to close
                return true;
            }
            // 下面是根据统计信息判断 是否是要开启
            // 统计信息
            HealthCounts health = metrics.getHealthCounts();

            // 样本不足
            if (health.getTotalRequests() < properties.circuitBreakerRequestVolumeThreshold().get()) {
                // we are not past the minimum volume threshold for the statisticalWindow so we'll return false immediately and not calculate anything
                return false;
            }
            // 错误比例未达标
            if (health.getErrorPercentage() < properties.circuitBreakerErrorThresholdPercentage().get()) {
                return false;
            } else {
                // 这里说明有问题了 要断开断路器
                // 标记状态
                if (circuitOpen.compareAndSet(false, true)) {
                    // 标记半开时间
                    // 这里是判断是否半开的关键 
                    // 如果超过这个时间5s 就可以放一个请求过去 然后在设置这个时间 在等
                    circuitOpenedOrLastTestedTime.set(System.currentTimeMillis());
                    return true;
                } else {
                    // How could previousValue be true? If another thread was going through this code at the same time a race-condition could have
                    // caused another thread to set it to true already even though we were in the process of doing the same
                    // In this case, we know the circuit is open, so let the other thread set the currentTime and report back that the circuit is open
                    return true;
                }
            }
        }
    }
    //com.netflix.hystrix.HystrixCircuitBreaker.HystrixCircuitBreakerImpl#allowSingleTest
    public boolean allowSingleTest() {
        long timeCircuitOpenedOrWasLastTested = circuitOpenedOrLastTestedTime.get();
        // 如果已经超过半开时间了
        if (circuitOpen.get() && System.currentTimeMillis() > timeCircuitOpenedOrWasLastTested + properties.circuitBreakerSleepWindowInMilliseconds().get()) {
           // 尝试放一个请求过去 这里会有多线程问题 用Atomic解决
           // 然后再次保存这个时间
           // 下一个半开请求要再等5s
            if (circuitOpenedOrLastTestedTime.compareAndSet(timeCircuitOpenedOrWasLastTested, System.currentTimeMillis())) {
                return true;
            }
        }
        return false;
    }
    //com.netflix.hystrix.HystrixCircuitBreaker.HystrixCircuitBreakerImpl#markSuccess
    // 半开状态下请求成功
    // 将断路由器闭合 并且重新开始统计
    public void markSuccess() {
        if (circuitOpen.get()) {
            // 修改状态
            if (circuitOpen.compareAndSet(true, false)) {
                // 重新开始统计
                metrics.resetStream();
            }
        }
    }
    ```
- 断路器断开callback处理(其他错误的callback与这个主流程一致)
    ```java
    // com.netflix.hystrix.AbstractCommand#handleShortCircuitViaFallback
    private Observable<R> handleShortCircuitViaFallback() {
        // 标记一下失败类型
        eventNotifier.markEvent(HystrixEventType.SHORT_CIRCUITED, commandKey);
        // short-circuit and go directly to fallback (or throw an exception if no fallback implemented)
        Exception shortCircuitException = new RuntimeException("Hystrix circuit short-circuited and is OPEN");
        executionResult = executionResult.setExecutionException(shortCircuitException);
        try {
            //走统一的Fallback逻辑
            return getFallbackOrThrowException(this, HystrixEventType.SHORT_CIRCUITED, FailureType.SHORTCIRCUIT,
                    "short-circuited", shortCircuitException);
        } catch (Exception e) {
            return Observable.error(e);
        }
    }
    // com.netflix.hystrix.AbstractCommand#getFallbackOrThrowException
    private Observable<R> getFallbackOrThrowException(final AbstractCommand<R> _cmd, final HystrixEventType eventType, final FailureType failureType, final String message, final Exception originalException) {
        
        // 省略1亿行非主流代码
        //...
        // 构建fallback链
        Observable<R> fallbackExecutionChain;

        // fallback也可以控制速率 但是一般没人控制
        if (fallbackSemaphore.tryAcquire()) {
            try {
                if (isFallbackUserDefined()) {
                    executionHook.onFallbackStart(this);
                    // 取fallbck实际实现
                    fallbackExecutionChain = getFallbackObservable();
                } else {
                    //same logic as above without the hook invocation
                    fallbackExecutionChain = getFallbackObservable();
                }
            } catch (Throwable ex) {
                //If hook or user-fallback throws, then use that as the result of the fallback lookup
                fallbackExecutionChain = Observable.error(ex);
            }

            // 构建链 实际就看
            return fallbackExecutionChain
                    .doOnEach(setRequestContext)
                    .lift(new FallbackHookApplication(_cmd))
                    .lift(new DeprecatedOnFallbackHookApplication(_cmd))
                    .doOnNext(markFallbackEmit)
                    .doOnCompleted(markFallbackCompleted)
                    .onErrorResumeNext(handleFallbackError)
                    .doOnTerminate(singleSemaphoreRelease)
                    .doOnUnsubscribe(singleSemaphoreRelease);
        } else {
            return handleFallbackRejectionByEmittingError();
        }
    } else {
        return handleFallbackDisabledByEmittingError(originalException, failureType, message);
    }
    // com.netflix.hystrix.HystrixCommand#getFallbackObservable
    final protected Observable<R> getFallbackObservable() {
        return Observable.defer(new Func0<Observable<R>>() {
            @Override
            public Observable<R> call() {
                try {
                    // 返回自定义的fallback
                    return Observable.just(getFallback());
                } catch (Throwable ex) {
                    return Observable.error(ex);
                }
            }
        });
    }
    ```

- 线程池的隔离
    ```java
    //com.netflix.hystrix.AbstractCommand#executeCommandAndObserve
    private Observable<R> executeCommandAndObserve(final AbstractCommand<R> _cmd) {
        final HystrixRequestContext currentRequestContext = HystrixRequestContext.getContextForCurrentThread();
        //...
        // 失败的回调
        final Func1<Throwable, Observable<R>> handleFallback = new Func1<Throwable, Observable<R>>() {
            // 这里的fallback逻辑和刚才的断路器断开基本上是一样的
            @Override
            public Observable<R> call(Throwable t) {
                Exception e = getExceptionFromThrowable(t);
                executionResult = executionResult.setExecutionException(e);
                // 队列过长
                if (e instanceof RejectedExecutionException) {
                    return handleThreadPoolRejectionViaFallback(e);
                    // 执行报错
                } else if (t instanceof HystrixTimeoutException) {
                    return handleTimeoutViaFallback();
                } else if (t instanceof HystrixBadRequestException) {
                    // Bad Request
                    return handleBadRequestByEmittingError(e);
                } else {
                    /*
                     * Treat HystrixBadRequestException from ExecutionHook like a plain HystrixBadRequestException.
                     */
                    if (e instanceof HystrixBadRequestException) {
                        eventNotifier.markEvent(HystrixEventType.BAD_REQUEST, commandKey);
                        return Observable.error(e);
                    }

                    return handleFailureViaFallback(e);
                }
            }
        };

       //...

        Observable<R> execution;
        if (properties.executionTimeoutEnabled().get()) {
            // 取线程池执行
            execution = executeCommandWithSpecifiedIsolation(_cmd)
                    // 下面这个就是超时控制逻辑
                    .lift(new HystrixObservableTimeoutOperator<R>(_cmd));
        } else {
            execution = executeCommandWithSpecifiedIsolation(_cmd);
        }

        return execution.doOnNext(markEmits)
                .doOnCompleted(markOnCompleted)
                .onErrorResumeNext(handleFallback)
                .doOnEach(setRequestContext);
    }
    // com.netflix.hystrix.AbstractCommand#executeCommandWithSpecifiedIsolation
    private Observable<R> executeCommandWithSpecifiedIsolation(final AbstractCommand<R> _cmd) {
        if (properties.executionIsolationStrategy().get() == ExecutionIsolationStrategy.THREAD) {
            // mark that we are executing in a thread (even if we end up being rejected we still were a THREAD execution and not SEMAPHORE)
            return Observable.defer(new Func0<Observable<R>>() {
                @Override
                public Observable<R> call() {
                    //..
                    // 省略1亿行判断
                        try {
                            executionHook.onThreadStart(_cmd);
                            executionHook.onRunStart(_cmd);
                            executionHook.onExecutionStart(_cmd);
                            // 这就是执行逻辑
                            return getUserExecutionObservable(_cmd);
                        } catch (Throwable ex) {
                            return Observable.error(ex);
                        }
                    } else {
                        //command has already been unsubscribed, so return immediately
                        return Observable.error(new RuntimeException("unsubscribed before executing run()"));
                    }
                }
            // 省略1亿个回调 
            }).subscribeOn(threadPool.getScheduler(new Func0<Boolean>() {
                @Override
                public Boolean call() {
                    // 这就超时的判断逻辑
                    return properties.executionIsolationThreadInterruptOnTimeout().get() && _cmd.isCommandTimedOut.get() == TimedOutStatus.TIMED_OUT;
                }
            }));
        }
        //...
    }
    // com.netflix.hystrix.HystrixCommand#getExecutionObservable
    final protected Observable<R> getExecutionObservable() {
        return Observable.defer(new Func0<Observable<R>>() {
            @Override
            public Observable<R> call() {
                try {
                    // 返回自定义的run
                    return Observable.just(run());
                } catch (Throwable ex) {
                    return Observable.error(ex);
                }
            }
        }).doOnSubscribe(new Action0() {
            @Override
            public void call() {
                // Save thread on which we get subscribed so that we can interrupt it later if needed
                executionThread.set(Thread.currentThread());
            }
        });
    }
    // com.netflix.hystrix.strategy.concurrency.HystrixContextScheduler.HystrixContextSchedulerWorker#schedule(rx.functions.Action0, long, java.util.concurrent.TimeUnit)
    // 订阅之后将任务放入队列中
    public Subscription schedule(Action0 action, long delayTime, TimeUnit unit) {
        if (threadPool != null) {
            // 看队列是否还有空间
            if (!threadPool.isQueueSpaceAvailable()) {
                throw new RejectedExecutionException("Rejected command because thread-pool queueSize is at rejection threshold.");
            }
        }
        // 实际提交到线程池
        return worker.schedule(new HystrixContexSchedulerAction(concurrencyStrategy, action), delayTime, unit);
    }
    //com.netflix.hystrix.strategy.concurrency.HystrixContextScheduler.ThreadPoolWorker#schedule(rx.functions.Action0)
    public Subscription schedule(final Action0 action) {
        if (subscription.isUnsubscribed()) {
            // don't schedule, we are unsubscribed
            return Subscriptions.unsubscribed();
        }

        // This is internal RxJava API but it is too useful.
        ScheduledAction sa = new ScheduledAction(action);

        subscription.add(sa);
        sa.addParent(subscription);
        // 提交到自己的线程池中
        ThreadPoolExecutor executor = (ThreadPoolExecutor) threadPool.getExecutor();
        // 返回一个future
        FutureTask<?> f = (FutureTask<?>) executor.submit(sa);
        // 这历史超时处理的关键
        sa.add(new FutureCompleterWithConfigurableInterrupt(f, shouldInterruptThread, executor));
        return sa;
    }
    ```

- 超时处理
    ```java
    //com.netflix.hystrix.AbstractCommand.HystrixObservableTimeoutOperator#call
    public Subscriber<? super R> call(final Subscriber<? super R> child) {
        //...

        TimerListener listener = new TimerListener() {

            // 到时间了 就去调用unsubscribe 尝试中断执行线程
            // 并取消客户端阻塞
            @Override
            public void tick() {
                // if we can go from NOT_EXECUTED to TIMED_OUT then we do the timeout codepath
                // otherwise it means we lost a race and the run() execution completed or did not start
                if (originalCommand.isCommandTimedOut.compareAndSet(TimedOutStatus.NOT_EXECUTED, TimedOutStatus.TIMED_OUT)) {
                    // report timeout failure
                    originalCommand.eventNotifier.markEvent(HystrixEventType.TIMEOUT, originalCommand.commandKey);

                    // shut down the original request
                    s.unsubscribe();

                    timeoutRunnable.run();
                    //if it did not start, then we need to mark a command start for concurrency metrics, and then issue the timeout
                }
            }

            @Override
            public int getIntervalTimeInMilliseconds() {
                return originalCommand.properties.executionTimeoutInMilliseconds().get();
            }
        };

        // 创建一个timer
        // timer内部有调度线程池
        final Reference<TimerListener> tl = HystrixTimer.getInstance().addTimerListener(listener);
        // set externally so execute/queue can see this
        originalCommand.timeoutTimer.set(tl);
        //...
        return parent;
    }
    ```

## 总结
太特么难了