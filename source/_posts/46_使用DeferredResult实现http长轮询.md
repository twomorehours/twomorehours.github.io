---
title: 使用DeferredResult实现http长轮询
date: 2019-04-13 21:30:39
categories:
- springboot
---

## 客户端如何及时感知服务端的变化
- 轮询
  - 频率低了不及时，频率高了占用服务端资源(cpu和网络)
- 推送
  - websocket编程比较复杂
- 长轮询
  - 实时性较高，占用资源较低，编程模型简单


## 使用`spring DeferredResult` 实现http长轮询
```java
@RequestMapping("/longpoll")
public DeferredResult<String> longPoll() {
    // 设置一个超时时间 和超时默认值
    DeferredResult<String> result = new DeferredResult<>(5000L, "timeout");
    // 异步处理
    new Thread(() -> {
        try {
            Thread.sleep(2000);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
        if (Math.random() > 0.5) {
            // 设置结果
            result.setResult("success");
        }
    }).start();
    // 直接返回
    return result;
}
```

## 优势
- `DeferredResult`不阻塞服务端线程

## 使用方向
- 配置中心配置变更通知（Apollo）
- 任务处理进度条拉取 （共享单车开锁）