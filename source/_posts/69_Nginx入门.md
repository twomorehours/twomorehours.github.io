---
title: nginx入门
date: 2019-03-22 21:30:39
categories:
- nginx
---

## 概念
nginx是一个web服务器，一般用于静态文件服务器，或者http反向代理服务器，用于反向代理服务器时，nginx根据http报文中的数据进行转发

## 组成
- 二进制文件
    - nginx编译之后就是一个二进制可执行文件
nginx.conf
    - nginx的核心配置文件，所有配置都写在这里，当然可以进行`include`
access.log
    - nginx的访问日志
errer.log
    - nginx的错误日志

## nginx的模块化设计
nginx使用模块化设计，需要什么功能就引入什么模块
- 核心模块
- HTTP模块
    - 处理http请求
- SSL模块
    - 处理https
- gzip模块
    - 处理压缩
- ...

## nginx的事件驱动模型
nginx采用的是多进程单线程的模型，使用epoll模型实现非阻塞网络通信

## nginx的多进程模型
- Master
    - 管理工作进程
        - 监视worker状态，使之保持在配置的个数
        - 处理各种信号（reload/quit/stop），并通知worker
- Worker
    - 处理客户端请求
    - 接收主进程的信号
- Cache Loader
    - 启动定时加载缓存
- Cache Manager
    - 管理缓存的进程，实现缓存的淘汰等

- 优点
    - 多Worker稳定性高 相互不影响
    - 进程独立，减小锁开销
                

## nginx的进程通信
- worker间共享内存
    - 虚拟内存指向一块物理内存
    - 共享缓存数据
    - 共享流量控制信息
- 信号
    - Master到worker下发指令的方式


## nginx的反向代理请求处理流程
- Master绑定端口
- 接收客户端请求
- 注册socket read事件
- 处理可读事件
- 客户端发送请求头
- 客户端发送包体
- nginx调用各个模块处理
- nginx请求真正的后端
- nginx缓存响应
- 响应客户端

## nginx的常见参数配置
- worker process
    - worker的进程数，一般设置为cpu的核数即可，因为nginx是非阻塞模型，更倾向于cpu密集型程序
- worker connections
    - 每个worker总的连接数，还取决于ulimit(单个进程)/file-max(总进程)的配置
- sendfile 
    - 领拷贝技术，获取文件资源的时候，直接利用DMA拷贝到socket缓冲区，不需要拷贝到用户空间
- keepalive_timeout
    - tcp长连接保持时间
- accept_mutex
    - 处理惊群问题
        - 惊群问题是多个worker进程监听同一个端口的accept事件，但是每次只能有一个worker获取到这个事件，其他worker也同样被唤醒，这样的唤醒没有意义
        - nginx加了一个锁，每次只能有一个worker获取锁成功，等待accept事件，获取不到锁的worker直接返回，不加入到socket的等待队列

## nginx的特点
- 优点
    - 跨平台 
    - 可压缩
    - 占用资源小
    - 性能高
    - 容易使用
- 缺点
    - 只支持端口探测
        - 微服务刚刚启动时，很多东西还没初始化完成，这个时候访问，会有超时的可能
        - 解决方案
            - 重启前摘除节点（reload），启动初始化结束后重新挂回

## nginx的reload操作
- 给master 发信号
- Master检查配置文件
- 监听新端口（如果有）
- 启动新的worker
- 杀掉老的worker

## nginx反向代理的常用配置
- http
```text
http {
    charset utf-8;
    keepalive_timeout 60; # 客户端长连接保持时间
    client_header_timeout  1m; # 读取客户端header超时
    client_body_timeout    1m; # 读取客户端body超时
    send_timeout           1m; # 响应客户端超时
    client_max_body_size 50m; # 客户端最大body
    client_body_buffer_size 50m; # 读取客户端body缓冲区大小
    proxy_connect_timeout 5; # 后端服务器连接超时
    proxy_send_timeout 15; # 发送数据到后端服务器超时
    proxy_read_timeout 15; # 读取后端服务器响应超时
    include ../conf.d/*.conf; # include server配置
    include ../upstream.d/*.conf; # include upstream配置
}
```

- server
```
server {
    listen 80; # 监听的端口
    server_name 106.12.15.56; # 虚拟主机名称
    charset utf-8;
    access_log logs/tmh.log main; # access日志位置
    error_log logs/tmh.log error; # error日志位置
    location /{
        //...
    }
}
```

- location
```text
location/{
    set $host_pass backend_pool; # 后端服务器upstream
    proxy_next_upstream http_502 error timeout; # 请求下一个upstream的条件
    proxy_pass http://$host_pass; # upstream地址
    proxy_set_header Host $host; # 设置host信息为原始的host信息
    proxy_set_header X-Forwarded-For $remote_addr; # 设置X-Forwarded-For信息为客户端IP
    proxy_set_header X-Real-IP $remote_addr; # 设置X-Real-IP信息为客户端IP
    proxy_set_header X-Forwarded-Proto $scheme; # 设置X-Forwarded-Proto为原请求协议
}
```

## nginx简单的正向代理实现
```
http {
    # 省略http配置信息
    server {
        listen 90;
        resolver 114.114.114.114; # 设置DNS
        server_name localhost; 
        charset utf-8;
        access_log logs/fwd.access.log main;
        error_log logs/fwd.error.log error;
        location /{
            proxy_pass http://$host$request_uri; # 客户端将真实的Host写到Header中
        }
    }
}

curl --proxy localhost:90 http://www.baidu.com
```