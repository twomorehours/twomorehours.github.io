---
title: RocketMQ的延时消息和失败重试
date: 2019-05-30 10:07:39
tags:
categories:
- java
- RocketMQ
---

## 延时消息的原理
- RocketMQ的延时消息是分延时等级的，不能自己指定延时的具体时间
- Broker收到延时消息后，将topic改写为`Schedule_topic_xxx`,并且将原topic保存在props中
- Broker有定时任务去扫这个topic下面的queue，每个queue是一个延时等级，所以所以每个queue一定是先进先出的
- 当任务发现延时任务的延时时间到了之后就会取出来然后重新投递到设置回原来的topic和queue，再次投递到commitLog中，作为一个普通消息

## 延时消息实现
- Broker收到消息
    ```java
    //org.apache.rocketmq.store.CommitLog#asyncPutMessage
     public CompletableFuture<PutMessageResult> asyncPutMessage(final MessageExtBrokerInner msg) {
        // Set the storage time
        //...
        final int tranType = MessageSysFlag.getTransactionValue(msg.getSysFlag());
        if (tranType == MessageSysFlag.TRANSACTION_NOT_TYPE
                || tranType == MessageSysFlag.TRANSACTION_COMMIT_TYPE) {
            // Delay Delivery
            if (msg.getDelayTimeLevel() > 0) {
                // 是延时消息
                if (msg.getDelayTimeLevel() > this.defaultMessageStore.getScheduleMessageService().getMaxDelayLevel()) {
                    msg.setDelayTimeLevel(this.defaultMessageStore.getScheduleMessageService().getMaxDelayLevel());
                }

                // 延时消息固定topic
                topic = ScheduleMessageService.SCHEDULE_TOPIC;
                // queueId就是延时等级-1
                queueId = ScheduleMessageService.delayLevel2QueueId(msg.getDelayTimeLevel());

                // Backup real topic, queueId
                // 保存下真实的topic和queue
                MessageAccessor.putProperty(msg, MessageConst.PROPERTY_REAL_TOPIC, msg.getTopic());
                MessageAccessor.putProperty(msg, MessageConst.PROPERTY_REAL_QUEUE_ID, String.valueOf(msg.getQueueId()));
                msg.setPropertiesString(MessageDecoder.messageProperties2String(msg.getProperties()));
                // 设置上延时的topic和queue
                msg.setTopic(topic);
                msg.setQueueId(queueId);
            }
        }

       //...
    }
    ```

- 延时消息定时任务
    ```java
    //org.apache.rocketmq.store.schedule.ScheduleMessageService#start
    public void start() {
        if (started.compareAndSet(false, true)) {
            this.timer = new Timer("ScheduleMessageTimerThread", true);
            for (Map.Entry<Integer, Long> entry : this.delayLevelTable.entrySet()) {
                Integer level = entry.getKey();
                Long timeDelay = entry.getValue();
                Long offset = this.offsetTable.get(level);
                if (null == offset) {
                    offset = 0L;
                }

                if (timeDelay != null) {
                    // 为每个延时queue启动一个调度任务
                    // 注意这里是一个线程
                    this.timer.schedule(new DeliverDelayedMessageTimerTask(level, offset), FIRST_DELAY_TIME);
                }
            }

           //...
        }
    }
    //org.apache.rocketmq.store.schedule.ScheduleMessageService.DeliverDelayedMessageTimerTask#executeOnTimeup
    public void executeOnTimeup() {
        // 取出延时queue
        ConsumeQueue cq =
            ScheduleMessageService.this.defaultMessageStore.findConsumeQueue(SCHEDULE_TOPIC,
                delayLevel2QueueId(delayLevel));

        long failScheduleOffset = offset;

        if (cq != null) {
            SelectMappedBufferResult bufferCQ = cq.getIndexBuffer(this.offset);
            if (bufferCQ != null) {
                try {
                    long nextOffset = offset;
                    int i = 0;
                    // 取出一个数据
                    ConsumeQueueExt.CqExtUnit cqExtUnit = new ConsumeQueueExt.CqExtUnit();
                    for (; i < bufferCQ.getSize(); i += ConsumeQueue.CQ_STORE_UNIT_SIZE) {
                        long offsetPy = bufferCQ.getByteBuffer().getLong();
                        int sizePy = bufferCQ.getByteBuffer().getInt();
                        long tagsCode = bufferCQ.getByteBuffer().getLong();

                        if (cq.isExtAddr(tagsCode)) {
                            if (cq.getExt(tagsCode, cqExtUnit)) {
                                tagsCode = cqExtUnit.getTagsCode();
                            } else {
                                //can't find ext content.So re compute tags code.
                                log.error("[BUG] can't find consume queue extend file content!addr={}, offsetPy={}, sizePy={}",
                                    tagsCode, offsetPy, sizePy);
                                long msgStoreTime = defaultMessageStore.getCommitLog().pickupStoreTimestamp(offsetPy, sizePy);
                                tagsCode = computeDeliverTimestamp(delayLevel, msgStoreTime);
                            }
                        }
                        // 看下这个任务要执行的时间
                        long now = System.currentTimeMillis();
                        long deliverTimestamp = this.correctDeliverTimestamp(now, tagsCode);

                        nextOffset = offset + (i / ConsumeQueue.CQ_STORE_UNIT_SIZE);

                        long countdown = deliverTimestamp - now;

                        // 现在就要执行
                        if (countdown <= 0) {
                            MessageExt msgExt =
                                ScheduleMessageService.this.defaultMessageStore.lookMessageByOffset(
                                    offsetPy, sizePy);

                            if (msgExt != null) {
                                try {
                                    // 将原来的消息topic和queue还原出来
                                    MessageExtBrokerInner msgInner = this.messageTimeup(msgExt);
                                    if (MixAll.RMQ_SYS_TRANS_HALF_TOPIC.equals(msgInner.getTopic())) {
                                        log.error("[BUG] the real topic of schedule msg is {}, discard the msg. msg={}",
                                                msgInner.getTopic(), msgInner);
                                        continue;
                                    }
                                    //将消息放入存储中
                                    PutMessageResult putMessageResult =
                                        ScheduleMessageService.this.writeMessageStore
                                            .putMessage(msgInner);

                                    if (putMessageResult != null
                                        && putMessageResult.getPutMessageStatus() == PutMessageStatus.PUT_OK) {
                                        continue;
                                    } else {
                                        // XXX: warn and notify me
                                        log.error(
                                            "ScheduleMessageService, a message time up, but reput it failed, topic: {} msgId {}",
                                            msgExt.getTopic(), msgExt.getMsgId());
                                            // 如果失败了稍后重试
                                        ScheduleMessageService.this.timer.schedule(
                                            new DeliverDelayedMessageTimerTask(this.delayLevel,
                                                nextOffset), DELAY_FOR_A_PERIOD);
                                        ScheduleMessageService.this.updateOffset(this.delayLevel,
                                            nextOffset);
                                        return;
                                    }
                                } catch (Exception e) {
                                    /*
                                        * XXX: warn and notify me



                                        */
                                    log.error(
                                        "ScheduleMessageService, messageTimeup execute error, drop it. msgExt="
                                            + msgExt + ", nextOffset=" + nextOffset + ",offsetPy="
                                            + offsetPy + ",sizePy=" + sizePy, e);
                                }
                            }
                        } else {
                            // 如果还没到执行时间
                            // 那么就设置到下次执行的时间
                            ScheduleMessageService.this.timer.schedule(
                                new DeliverDelayedMessageTimerTask(this.delayLevel, nextOffset),
                                countdown);
                            ScheduleMessageService.this.updateOffset(this.delayLevel, nextOffset);
                            return;
                        }
                    } // end of for
                    // 如果里面没有数据 则过100ms再检查一次
                    nextOffset = offset + (i / ConsumeQueue.CQ_STORE_UNIT_SIZE);
                    ScheduleMessageService.this.timer.schedule(new DeliverDelayedMessageTimerTask(
                        this.delayLevel, nextOffset), DELAY_FOR_A_WHILE);
                    ScheduleMessageService.this.updateOffset(this.delayLevel, nextOffset);
                    return;
                } finally {

                    bufferCQ.release();
                }
            } // end of if (bufferCQ != null)
            else {

                long cqMinOffset = cq.getMinOffsetInQueue();
                if (offset < cqMinOffset) {
                    failScheduleOffset = cqMinOffset;
                    log.error("schedule CQ offset invalid. offset=" + offset + ", cqMinOffset="
                        + cqMinOffset + ", queueId=" + cq.getQueueId());
                }
            }
        } // end of if (cq != null)

        ScheduleMessageService.this.timer.schedule(new DeliverDelayedMessageTimerTask(this.delayLevel,
            failScheduleOffset), DELAY_FOR_A_WHILE);
    }
    ```

## 重试消息的原理
- Consumer启动是会自动订阅一个`Retrytopic消费组名`，所有重试消息都会发到这个组里
- 失败的消息会被重新发送到Broker，并且记录一个已经失败了几次
- Broker收到消息后计算延时的等级，然后设置进去，然后交给正常的消息逻辑处理
- MessageStore就会把这条消息当作延时消息处理，当延时时间到了的时候就取出来发出去

## 重试消息实现
- 自动订阅`RETRY TOPIC`
    ```java
    //org.apache.rocketmq.client.impl.consumer.DefaultMQPushConsumerImpl#copySubscription
    private void copySubscription() throws MQClientException {
        try {
            Map<String, String> sub = this.defaultMQPushConsumer.getSubscription();
            //...

            switch (this.defaultMQPushConsumer.getMessageModel()) {
                case BROADCASTING:
                    break;
                case CLUSTERING:
                    // 订阅retrytopic
                    final String retryTopic = MixAll.getRetryTopic(this.defaultMQPushConsumer.getConsumerGroup());
                    SubscriptionData subscriptionData = FilterAPI.buildSubscriptionData(this.defaultMQPushConsumer.getConsumerGroup(),
                        retryTopic, SubscriptionData.SUB_ALL);
                    this.rebalanceImpl.getSubscriptionInner().put(retryTopic, subscriptionData);
                    break;
                default:
                    break;
            }
        } catch (Exception e) {
            throw new MQClientException("subscription exception", e);
        }
    }
    ```
- 消费返回`reconsume later`
    ```java
    //org.apache.rocketmq.client.impl.consumer.ConsumeMessageConcurrentlyService#processConsumeResult
    public void processConsumeResult(
        final ConsumeConcurrentlyStatus status,
        final ConsumeConcurrentlyContext context,
        final ConsumeRequest consumeRequest
    ) {
        int ackIndex = context.getAckIndex();

        if (consumeRequest.getMsgs().isEmpty())
            return;

        switch (status) {
            case CONSUME_SUCCESS:
                //...
                break;
            case RECONSUME_LATER:
                // 将ackIndex设置为-1
                ackIndex = -1;
                this.getConsumerStatsManager().incConsumeFailedTPS(consumerGroup, consumeRequest.getMessageQueue().getTopic(),
                    consumeRequest.getMsgs().size());
                break;
            default:
                break;
        }

        switch (this.defaultMQPushConsumer.getMessageModel()) {
            case BROADCASTING:
                for (int i = ackIndex + 1; i < consumeRequest.getMsgs().size(); i++) {
                    MessageExt msg = consumeRequest.getMsgs().get(i);
                    log.warn("BROADCASTING, the message consume failed, drop it, {}", msg.toString());
                }
                break;
            case CLUSTERING:
                List<MessageExt> msgBackFailed = new ArrayList<MessageExt>(consumeRequest.getMsgs().size());
                for (int i = ackIndex + 1; i < consumeRequest.getMsgs().size(); i++) {
                    MessageExt msg = consumeRequest.getMsgs().get(i);
                    // 将失败的消息发回去
                    boolean result = this.sendMessageBack(msg, context);
                    if (!result) {
                        msg.setReconsumeTimes(msg.getReconsumeTimes() + 1);
                        msgBackFailed.add(msg);
                    }
                }

                if (!msgBackFailed.isEmpty()) {
                    consumeRequest.getMsgs().removeAll(msgBackFailed);
                    // 如果失败了 就放到队列里面尝试往回发
                    this.submitConsumeRequestLater(msgBackFailed, consumeRequest.getProcessQueue(), consumeRequest.getMessageQueue());
                }
                break;
            default:
                break;
        }

        //...
    }
    //org.apache.rocketmq.client.impl.consumer.DefaultMQPushConsumerImpl#sendMessageBack
    public void sendMessageBack(MessageExt msg, int delayLevel, final String brokerName)
        throws RemotingException, MQBrokerException, InterruptedException, MQClientException {
        try {
            String brokerAddr = (null != brokerName) ? this.mQClientFactory.findBrokerAddressInPublish(brokerName)
                : RemotingHelper.parseSocketAddressAddr(msg.getStoreHost());
                // 发回去
            this.mQClientFactory.getMQClientAPIImpl().consumerSendMessageBack(brokerAddr, msg,
                this.defaultMQPushConsumer.getConsumerGroup(), delayLevel, 5000, getMaxReconsumeTimes());
        } catch (Exception e) {
            //...
        } finally {
            msg.setTopic(NamespaceUtil.withoutNamespace(msg.getTopic(), this.defaultMQPushConsumer.getNamespace()));
        }
    }
    //org.apache.rocketmq.client.impl.consumer.DefaultMQPushConsumerImpl#sendMessageBack
     public void sendMessageBack(MessageExt msg, int delayLevel, final String brokerName)
        throws RemotingException, MQBrokerException, InterruptedException, MQClientException {
        try {
            String brokerAddr = (null != brokerName) ? this.mQClientFactory.findBrokerAddressInPublish(brokerName)
                : RemotingHelper.parseSocketAddressAddr(msg.getStoreHost());
            this.mQClientFactory.getMQClientAPIImpl().consumerSendMessageBack(brokerAddr, msg,
                this.defaultMQPushConsumer.getConsumerGroup(), delayLevel, 5000, getMaxReconsumeTimes());
        } catch (Exception e) {
            log.error("sendMessageBack Exception, " + this.defaultMQPushConsumer.getConsumerGroup(), e);

            Message newMsg = new Message(MixAll.getRetryTopic(this.defaultMQPushConsumer.getConsumerGroup()), msg.getBody());

            String originMsgId = MessageAccessor.getOriginMessageId(msg);
            MessageAccessor.setOriginMessageId(newMsg, UtilAll.isBlank(originMsgId) ? msg.getMsgId() : originMsgId);

            newMsg.setFlag(msg.getFlag());
            MessageAccessor.setProperties(newMsg, msg.getProperties());
            MessageAccessor.putProperty(newMsg, MessageConst.PROPERTY_RETRY_TOPIC, msg.getTopic());
            // 设置消费失败次数
            // 最大失败次数
            MessageAccessor.setMaxReconsumeTimes(newMsg, String.valueOf(getMaxReconsumeTimes()));
            MessageAccessor.clearProperty(newMsg, MessageConst.PROPERTY_TRANSACTION_PREPARED);
            newMsg.setDelayTimeLevel(3 + msg.getReconsumeTimes());

            this.mQClientFactory.getDefaultMQProducer().send(newMsg);
        } finally {
            msg.setTopic(NamespaceUtil.withoutNamespace(msg.getTopic(), this.defaultMQPushConsumer.getNamespace()));
        }
    }
    ```

- Broker收到消息
    ```java
    //org.apache.rocketmq.broker.processor.SendMessageProcessor#asyncConsumerSendMsgBack
    private CompletableFuture<RemotingCommand> asyncConsumerSendMsgBack(ChannelHandlerContext ctx,
                                                                        RemotingCommand request) throws RemotingCommandException {
        final RemotingCommand response = RemotingCommand.createResponseCommand(null);
        final ConsumerSendMsgBackRequestHeader requestHeader =
                (ConsumerSendMsgBackRequestHeader)request.decodeCommandCustomHeader(ConsumerSendMsgBackRequestHeader.class);
        //...
        // 设置retry topic 
        String newTopic = MixAll.getRetryTopic(requestHeader.getGroup());
        // 随机选一个队列
        int queueIdInt = Math.abs(this.random.nextInt() % 99999999) % subscriptionGroupConfig.getRetryQueueNums();
        int topicSysFlag = 0;
        if (requestHeader.isUnitMode()) {
            topicSysFlag = TopicSysFlag.buildSysFlag(false, true);
        }
        //...
        MessageExt msgExt = this.brokerController.getMessageStore().lookMessageByOffset(requestHeader.getOffset());
        if (null == msgExt) {
            response.setCode(ResponseCode.SYSTEM_ERROR);
            response.setRemark("look message by offset failed, " + requestHeader.getOffset());
            return CompletableFuture.completedFuture(response);
        }

        final String retryTopic = msgExt.getProperty(MessageConst.PROPERTY_RETRY_TOPIC);
        if (null == retryTopic) {
            MessageAccessor.putProperty(msgExt, MessageConst.PROPERTY_RETRY_TOPIC, msgExt.getTopic());
        }
        msgExt.setWaitStoreMsgOK(false);

        int delayLevel = requestHeader.getDelayLevel();

        int maxReconsumeTimes = subscriptionGroupConfig.getRetryMaxTimes();
        if (request.getVersion() >= MQVersion.Version.V3_4_9.ordinal()) {
            maxReconsumeTimes = requestHeader.getMaxReconsumeTimes();
        }

        if (msgExt.getReconsumeTimes() >= maxReconsumeTimes 
            || delayLevel < 0) {
            // 超出最大的就放入死信队列中了
            newTopic = MixAll.getDLQTopic(requestHeader.getGroup());
            queueIdInt = Math.abs(this.random.nextInt() % 99999999) % DLQ_NUMS_PER_GROUP;

            topicConfig = this.brokerController.getTopicConfigManager().createTopicInSendMessageBackMethod(newTopic,
                    DLQ_NUMS_PER_GROUP,
                    PermName.PERM_WRITE, 0);
            if (null == topicConfig) {
                response.setCode(ResponseCode.SYSTEM_ERROR);
                response.setRemark("topic[" + newTopic + "] not exist");
                return CompletableFuture.completedFuture(response);
            }
        } else {
            if (0 == delayLevel) {
                // 延时等级为重试次数+3
                delayLevel = 3 + msgExt.getReconsumeTimes();
            }
            // 设置delaylevel 当作一个延时消息处理
            msgExt.setDelayTimeLevel(delayLevel);
        }

        // 构建消息发送消息
        //...
    }
    ```