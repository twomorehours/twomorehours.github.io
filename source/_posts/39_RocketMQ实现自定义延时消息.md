---
title: RocketMQ实现自定义延时消息
date: 2019-07-20 21:07:39
tags:
categories:
- java
- rocketmq
---

## 实现步骤
- 拦截构建队列DispatchRequest
- 将消息从commitLog取出，存入自定义目录
- 将索引放入时间轮
- 时间轮到时间了，用索引将消息取出发回
- 时间轮只hold30分钟内的数据，提前10s将下一个三十分钟的数据载入时间轮
- 定时checkpoint


## 具体代码
- 拦截构建队列DispatchRequest
    ```java
    // org.apache.rocketmq.store.DefaultMessageStore.CommitLogDispatcherBuildConsumeQueue#dispatch
    public void dispatch(DispatchRequest request) {
        boolean isDelay = request.getPropertiesMap().containsKey(MessageConst.PROPERTY_DELAY_TIME_IN_SECONDS);
        if(isDelay){
            DefaultMessageStore.this.getScheduleMessageService2().scheduleRequest(request);
            return;
        }
        //...
    }
    ```

- 将消息从commitLog取出，存入自定义目录
    ```java
    // org.apache.rocketmq.store.schedule.ScheduleMessageService2#scheduleRequest
    public synchronized void scheduleRequest(DispatchRequest request) {
        long now = System.currentTimeMillis();
        MessageExt messageExt = defaultMessageStore.lookMessageByOffset(
                request.getCommitLogOffset(), request.getMsgSize());
        if (messageExt == null) {
            return;
        }
        String property = messageExt.getProperty(MessageConst.PROPERTY_DELAY_TIME_IN_SECONDS);
        long executeTime = Long.parseLong(property) * 1000 + now;
        messageExt.putUserProperty(MessageConst.PROPERTY_EXECUTE_TIME_IN_SECONDS,
                String.valueOf(executeTime / 1000));
        MessageAccessor.clearProperty(messageExt, MessageConst.PROPERTY_DELAY_TIME_IN_SECONDS);
        long executeTimeInNumber = timeInNumber(executeTime);
        MappedFile mappedFile = logMap.get(executeTimeInNumber);
        if (mappedFile == null) {
            String storePathRootDir = defaultMessageStore.getMessageStoreConfig().getStorePathRootDir();
            String logPath = storePathRootDir + File.separator + "schedulelog" + File.separator + executeTimeInNumber;
            try {
                mappedFile = new MappedFile(logPath, 10 * 1024 * 1024);
                logMap.put(executeTimeInNumber, mappedFile);
            } catch (IOException e) {
                e.printStackTrace();
                return;
            }
        }
        AppendMessageResult result = mappedFile.appendMessage(toInner(messageExt),
                this.appendMessageCallback);
        if (!result.isOk()) {
            return;
        }
        if (now / 1000 + MINUTES_IN_MEMORY * 60 >= executeTime / 1000) {
            // 直接进入时间轮
            timeWheel.addTask(executeTime / 1000,
                    new TimeWheelTask(executeTimeInNumber, (int) result.getWroteOffset(),
                            result.getWroteBytes(), defaultMessageStore, logMap));
        }
    }
    ```
- 时间轮到时间了，用索引将消息取出发回
    ```java
    //org.apache.rocketmq.store.schedule.TimeWheelTask#run
    @Override
    public void run() {
        MappedFile mappedFile = logMap.get(timeInNumber);
        if (mappedFile == null) {
            return;
        }
        SelectMappedBufferResult mappedBuffer = mappedFile.selectMappedBuffer(offset, size);
        MessageExt messageExt = MessageDecoder.decode(mappedBuffer.getByteBuffer(), true, false);
        store.putMessage(ScheduleMessageService2.toInner(messageExt));
    }
    ```

- 定时载入消息,checkpoint
    ```java
    //org.apache.rocketmq.store.schedule.ScheduleMessageService2#start
    public void start() {
        if (!this.started.compareAndSet(false, true)) {
            return;
        }
        reputMessageThreadPool = Executors.newSingleThreadExecutor();
        scheduledExecutorService = Executors.newSingleThreadScheduledExecutor();
        this.timeWheel = new TimeWheel(MINUTES_IN_MEMORY * 60 + LOAD_IN_ADVANCE,
                reputMessageThreadPool);
        this.timeWheel.start();
        // 将checkpoint后的数据加载到内存
        for (Map.Entry<Long, MappedFile> entry : logMap.entrySet()) {
            MappedFile file = entry.getValue();
            int pos = loadMappedFile(entry.getKey(), file);
            file.setWrotePosition(pos);
            file.setFlushedPosition(pos);
            file.setCommittedPosition(pos);
        }
        //启动checkpoint
        scheduledExecutorService.scheduleAtFixedRate(new Runnable() {
            @Override
            public void run() {
                try {
                    // checkpoint
                    long checkpoint = timeWheel.getCurrentScheduleTime();
                    setCheckPoint(checkpoint);
                    // 清理内存
                    Iterator<Map.Entry<Long, MappedFile>> iterator = logMap.entrySet().iterator();
                    while (iterator.hasNext()) {
                        Map.Entry<Long, MappedFile> entry = iterator.next();
                        if (entry.getKey() < checkpoint) {
                            entry.getValue().release();
                            iterator.remove();
                        }
                    }
                } catch (IOException e) {
                    e.printStackTrace();
                }
                long now = System.currentTimeMillis();
                long nowNumber = timeInNumber(now);
                long nextNumber = timeInNumber(now + LOAD_IN_ADVANCE * 1000);
                if (nowNumber == nextNumber || !logMap.containsKey(nextNumber)) {
                    return;
                }
                loadMappedFile(nextNumber, logMap.get(nextNumber));
            }
        }, 0L, 5L, TimeUnit.SECONDS);
    }
    //org.apache.rocketmq.store.schedule.ScheduleMessageService2#loadMappedFile
    private int loadMappedFile(long key, MappedFile file) {
        ByteBuffer byteBuffer = file.getMappedByteBuffer().slice();
        int pos = 0;
        while (true) {
            byteBuffer.position(pos);
            int msgLength = byteBuffer.getInt();
            byteBuffer.position(pos);
            if (msgLength == 0) {
                break;
            }
            MessageExt messageExt = MessageDecoder.decode(byteBuffer, true, false);
            String property = messageExt.getProperty(
                    MessageConst.PROPERTY_EXECUTE_TIME_IN_SECONDS);
            try {
                // checkpoint 之前的不用处理
                if (Long.parseLong(property) <= getCheckpoint()) {
                    continue;
                }
            } catch (Exception e) {
                throw new RuntimeException(e);
            }

            timeWheel.addTask(Long.parseLong(property),
                    new TimeWheelTask(key, pos, msgLength, defaultMessageStore, logMap));
            pos += msgLength;
        }
        return pos;
    }
    ```

- 时间轮实现
    ```java
    package org.apache.rocketmq.store.util;


    import java.util.concurrent.*;
    import java.util.concurrent.atomic.AtomicBoolean;

    /**
    * 时间轮线程调度器
    *
    * @author zy-user
    */
    public class TimeWheel {

        private ConcurrentLinkedDeque<Runnable>[] buckets;
        private volatile int currIndex = -1;
        private ExecutorService executorService;
        private long timeSpanInSeconds;
        private long startTime;
        private long scheduleCount;
        private AtomicBoolean started = new AtomicBoolean(false);
        private ScheduledExecutorService scheduledExecutorService = Executors.newSingleThreadScheduledExecutor();

        /**
        * @param timeSpanInSeconds 时间轮的跨度
        * @param executorService   时间到了提交任务线程
        */
        public TimeWheel(int timeSpanInSeconds, ExecutorService executorService) {
            if (timeSpanInSeconds <= 0) {
                throw new IllegalArgumentException("wrong timeSpanInSeconds");
            }
            this.timeSpanInSeconds = timeSpanInSeconds;
            if (executorService == null || executorService.isShutdown()) {
                throw new IllegalArgumentException("wrong executorService");
            }
            this.executorService = executorService;
            this.buckets = new ConcurrentLinkedDeque[timeSpanInSeconds + 1];
            for (int i = 0; i < buckets.length; i++) {
                buckets[i] = new ConcurrentLinkedDeque<>();
            }
        }

        public void addTask(long executeTimeInSeconds, Runnable runnable) {
            long now = System.currentTimeMillis() / 1000;
            if (executeTimeInSeconds <= now) {
                scheduledExecutorService.execute(runnable);
                return;
            }
            if (executeTimeInSeconds > now + timeSpanInSeconds) {
                throw new IllegalArgumentException("wrong executeTime");
            }
            int newIndex = (((int) (executeTimeInSeconds - now)) + currIndex) % buckets.length;
            buckets[newIndex].addFirst(runnable);
        }

        public void start() {
            if (!started.compareAndSet(false, true)) {
                return;
            }
            startTime = System.currentTimeMillis() / 1000;
            scheduledExecutorService.schedule(new Runnable() {
                @Override
                public void run() {
                    if (!started.get()) {
                        return;
                    }
                    // 本轮的index
                    currIndex = (currIndex + 1) % buckets.length;
                    ConcurrentLinkedDeque<Runnable> bucket = buckets[currIndex];
                    Runnable r;
                    while ((r = bucket.pollLast()) != null) {
                        executorService.execute(r);
                    }
                    // 调度的次数
                    scheduleCount++;
                    // 下一次执行的时间=调度的次数
                    // 第一次调度在0s 第二次在1s ...
                    // 这样来补偿因为线程延迟带来的误差
                    long timeWait = scheduleCount - (System.currentTimeMillis() / 1000 - startTime);
                    scheduledExecutorService.schedule(this, timeWait <= 0 ? 0 : timeWait,
                            TimeUnit.SECONDS);
                }
            }, 0, TimeUnit.SECONDS);
        }

        public void stop() {
            if (started.compareAndSet(true, false)) {
                scheduledExecutorService.shutdown();
            }
        }

        public long getCurrentScheduleTime() {
            return startTime + scheduleCount;
        }

    }
    ```


## 详细代码
点击 [详细代码](https://github.com/twomorehours/rocketmq/tree/delay_message "延时消息实现"). 