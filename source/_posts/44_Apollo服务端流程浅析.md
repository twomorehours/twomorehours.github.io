---
title: Apollo服务端流程浅析
date: 2020-07-12 17:30:39
tags:
categories:
- Apollo
---

## 配置的新增
```java
//com.ctrip.framework.apollo.adminservice.controller.ItemController#create
@PreAcquireNamespaceLock // 先加锁
@PostMapping("/apps/{appId}/clusters/{clusterName}/namespaces/{namespaceName}/items")
public ItemDTO create(@PathVariable("appId") String appId,
                        @PathVariable("clusterName") String clusterName,
                        @PathVariable("namespaceName") String namespaceName, @RequestBody ItemDTO dto) {
    Item entity = BeanUtils.transform(Item.class, dto);

    ConfigChangeContentBuilder builder = new ConfigChangeContentBuilder();
    Item managedEntity = itemService.findOne(appId, clusterName, namespaceName, entity.getKey());
    if (managedEntity != null) {
      throw new BadRequestException("item already exists");
    }
    // 保存配置信息
    entity = itemService.save(entity);
    builder.createItem(entity);
    dto = BeanUtils.transform(ItemDTO.class, entity);

    // 保存commit记录
    Commit commit = new Commit();
    commit.setAppId(appId);
    commit.setClusterName(clusterName);
    commit.setNamespaceName(namespaceName);
    commit.setChangeSets(builder.build());
    commit.setDataChangeCreatedBy(dto.getDataChangeLastModifiedBy());
    commit.setDataChangeLastModifiedBy(dto.getDataChangeLastModifiedBy());
    commitService.save(commit);
    return dto;
}
```

## 配置的发布
```java
//com.ctrip.framework.apollo.adminservice.controller.ReleaseController#publish
@Transactional
  @PostMapping("/apps/{appId}/clusters/{clusterName}/namespaces/{namespaceName}/releases")
  public ReleaseDTO publish(@PathVariable("appId") String appId,
                            @PathVariable("clusterName") String clusterName,
                            @PathVariable("namespaceName") String namespaceName,
                            @RequestParam("name") String releaseName,
                            @RequestParam(name = "comment", required = false) String releaseComment,
                            @RequestParam("operator") String operator,
                            @RequestParam(name = "isEmergencyPublish", defaultValue = "false") boolean isEmergencyPublish) {
    Namespace namespace = namespaceService.findOne(appId, clusterName, namespaceName);
    if (namespace == null) {
      throw new NotFoundException(String.format("Could not find namespace for %s %s %s", appId,
                                                clusterName, namespaceName));
    }
    // 创建一个release记录
    Release release = releaseService.publish(namespace, releaseName, releaseComment, operator, isEmergencyPublish);

    // 创建一个releaseMessage
    //send release message
    Namespace parentNamespace = namespaceService.findParentNamespace(namespace);
    String messageCluster;
    if (parentNamespace != null) {
      messageCluster = parentNamespace.getClusterName();
    } else {
      messageCluster = clusterName;
    }
    // 发布releaseMessage
    messageSender.sendMessage(ReleaseMessageKeyGenerator.generate(appId, messageCluster, namespaceName),
                              Topics.APOLLO_RELEASE_TOPIC);
    return BeanUtils.transform(ReleaseDTO.class, release);
}
//com.ctrip.framework.apollo.biz.message.DatabaseMessageSender#sendMessage
 @Override
  @Transactional
  public void sendMessage(String message, String channel) {
    //...
    Transaction transaction = Tracer.newTransaction("Apollo.AdminService", "sendMessage");
    try {
        // 就是在数据库里面插入一条记录
        // ConfigService会扫描这张表
      ReleaseMessage newMessage = releaseMessageRepository.save(new ReleaseMessage(message));
      toClean.offer(newMessage.getId());
      transaction.setStatus(Transaction.SUCCESS);
    } catch (Throwable ex) {
      logger.error("Sending message to database failed", ex);
      transaction.setStatus(ex);
      throw ex;
    } finally {
      transaction.complete();
    }
}
```

## 配置的拉取
- 长轮询入口
    ```java
    //com.ctrip.framework.apollo.configservice.controller.NotificationControllerV2#pollNotification
    public DeferredResult<ResponseEntity<List<ApolloConfigNotification>>> pollNotification(
      @RequestParam(value = "appId") String appId,
      @RequestParam(value = "cluster") String cluster,
      @RequestParam(value = "notifications") String notificationsAsString,
      @RequestParam(value = "dataCenter", required = false) String dataCenter,
      @RequestParam(value = "ip", required = false) String clientIp) {
    List<ApolloConfigNotification> notifications = null;

    //...
    // 新建一个DeferredResult
    // DeferredResult就是spring提供的支持长轮询的组件
    // controller 结束时不会立即返回 如果没有result会等待一段时间在返回
    DeferredResultWrapper deferredResultWrapper = new DeferredResultWrapper(bizConfig.longPollingTimeoutInMilli());
    Set<String> namespaces = Sets.newHashSetWithExpectedSize(filteredNotifications.size());
    Map<String, Long> clientSideNotifications = Maps.newHashMapWithExpectedSize(filteredNotifications.size());
    
    for (Map.Entry<String, ApolloConfigNotification> notificationEntry : filteredNotifications.entrySet()) {
      String normalizedNamespace = notificationEntry.getKey();
      ApolloConfigNotification notification = notificationEntry.getValue();
      namespaces.add(normalizedNamespace);
      clientSideNotifications.put(normalizedNamespace, notification.getNotificationId());
      if (!Objects.equals(notification.getNamespaceName(), normalizedNamespace)) {
        deferredResultWrapper.recordNamespaceNameNormalizedResult(notification.getNamespaceName(), normalizedNamespace);
      }
    }

    Multimap<String, String> watchedKeysMap =
        watchKeysUtil.assembleAllWatchKeys(appId, cluster, namespaces, dataCenter);

    Set<String> watchedKeys = Sets.newHashSet(watchedKeysMap.values());

    // 先setresult 再去check 因为在这个区间可能handlemessage已经拿到结果了
    deferredResultWrapper
          .onTimeout(() -> logWatchedKeys(watchedKeys, "Apollo.LongPoll.TimeOutKeys"));

    deferredResultWrapper.onCompletion(() -> {
      //unregister all keys
      for (String key : watchedKeys) {
        deferredResults.remove(key, deferredResultWrapper);
      }
      logWatchedKeys(watchedKeys, "Apollo.LongPoll.CompletedKeys");
    });

    //register all keys
    for (String key : watchedKeys) {
      this.deferredResults.put(key, deferredResultWrapper);
    }

    logWatchedKeys(watchedKeys, "Apollo.LongPoll.RegisteredKeys");
    logger.debug("Listening {} from appId: {}, cluster: {}, namespace: {}, datacenter: {}",
        watchedKeys, appId, cluster, namespaces, dataCenter);

    /**
     * 2、check new release
     */
    List<ReleaseMessage> latestReleaseMessages =
        releaseMessageService.findLatestReleaseMessagesGroupByMessages(watchedKeys);

    /**
     * Manually close the entity manager.
     * Since for async request, Spring won't do so until the request is finished,
     * which is unacceptable since we are doing long polling - means the db connection would be hold
     * for a very long time
     */
    entityManagerUtil.closeEntityManager();

    List<ApolloConfigNotification> newNotifications =
        getApolloConfigNotifications(namespaces, clientSideNotifications, watchedKeysMap,
            latestReleaseMessages);

    // 如果由结果 直接设置进去
    if (!CollectionUtils.isEmpty(newNotifications)) {
      deferredResultWrapper.setResult(newNotifications);
    }

    return deferredResultWrapper.getResult();
  }
    ```

- 轮询检测ReleaseMessage
```java
//com.ctrip.framework.apollo.configservice.ConfigServiceAutoConfiguration.MessageScannerConfiguration#releaseMessageScanner
@Bean
    public ReleaseMessageScanner releaseMessageScanner() {
      ReleaseMessageScanner releaseMessageScanner = new ReleaseMessageScanner();
      //0. handle release message cache
      releaseMessageScanner.addMessageListener(releaseMessageServiceWithCache);
      //1. handle gray release rule
      releaseMessageScanner.addMessageListener(grayReleaseRulesHolder);
      //2. handle server cache
      releaseMessageScanner.addMessageListener(configService);
      releaseMessageScanner.addMessageListener(configFileController);
      //3. notify clients
      releaseMessageScanner.addMessageListener(notificationControllerV2);
      releaseMessageScanner.addMessageListener(notificationController);
      return releaseMessageScanner;
}
//com.ctrip.framework.apollo.biz.message.ReleaseMessageScanner#scanAndSendMessages
private boolean scanAndSendMessages() {
    //current batch is 500
    // 从上次扫描的id开始
    List<ReleaseMessage> releaseMessages =
        releaseMessageRepository.findFirst500ByIdGreaterThanOrderByIdAsc(maxIdScanned);
    if (CollectionUtils.isEmpty(releaseMessages)) {
      return false;
    }
    fireMessageScanned(releaseMessages);
    int messageScanned = releaseMessages.size();
    maxIdScanned = releaseMessages.get(messageScanned - 1).getId();
    return messageScanned == 500;
}
//com.ctrip.framework.apollo.configservice.controller.NotificationControllerV2#handleMessage
public void handleMessage(ReleaseMessage message, String channel) {
    logger.info("message received - channel: {}, message: {}", channel, message);

    String content = message.getMessage();
    Tracer.logEvent("Apollo.LongPoll.Messages", content);
    if (!Topics.APOLLO_RELEASE_TOPIC.equals(channel) || Strings.isNullOrEmpty(content)) {
      return;
    }

    String changedNamespace = retrieveNamespaceFromReleaseMessage.apply(content);

    if (Strings.isNullOrEmpty(changedNamespace)) {
      logger.error("message format invalid - {}", content);
      return;
    }

    // 判断是否要调用是这个deferredResult需要的
    if (!deferredResults.containsKey(content)) {
      return;
    }

    //create a new list to avoid ConcurrentModificationException
    List<DeferredResultWrapper> results = Lists.newArrayList(deferredResults.get(content));

    ApolloConfigNotification configNotification = new ApolloConfigNotification(changedNamespace, message.getId());
    configNotification.addMessage(content, message.getId());

    //客户端过多走异步通知
    if (results.size() > bizConfig.releaseMessageNotificationBatch()) {
      largeNotificationBatchExecutorService.submit(() -> {
        logger.debug("Async notify {} clients for key {} with batch {}", results.size(), content,
            bizConfig.releaseMessageNotificationBatch());
        for (int i = 0; i < results.size(); i++) {
          if (i > 0 && i % bizConfig.releaseMessageNotificationBatch() == 0) {
            try {
              TimeUnit.MILLISECONDS.sleep(bizConfig.releaseMessageNotificationBatchIntervalInMilli());
            } catch (InterruptedException e) {
              //ignore
            }
          }
          logger.debug("Async notify {}", results.get(i));
          results.get(i).setResult(configNotification);
        }
      });
      return;
    }

    logger.debug("Notify {} clients for key {}", results.size(), content);

    // 走同步通知
    for (DeferredResultWrapper result : results) {
      result.setResult(configNotification);
    }
    logger.debug("Notification completed");
}
```