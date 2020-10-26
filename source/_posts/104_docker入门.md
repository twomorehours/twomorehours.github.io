---
title: docker入门
date: 2021-02-05 23:30:39
categories:
- 云原生
tags:
- 虚拟化
- 容器
---

## 什么是容器
容器是沙箱技术，容器是一个特殊的进程，通过约束和修改进程的动态表现，为进程创造一个边界。

## Linux实现容器相关的技术
- Namespace
    - 修改进程能看到OS的范围
    - PID Mount Network UTS IPC User
- Cgropus
    - 限制进程组的资源
    - CPU 资源 磁盘 网络 等
- rootfs
    - 把一个宿主机上目录作为容器进程的根目录，为容器进程提供一个文件系统

## 容器的演进
- 物理机部署
    - 性能最好，但是没有资源隔离，安全性最差
- 虚拟机部署
    - 性能差（装多个OS，并且运行在虚拟机上），但是资源可以隔离，安全隔离彻底，启动最慢
- 容器部署
    - 直接物理运行，损耗小，支持资源隔离，但是没有虚拟化隔离的彻底，启动快，安全性能一般


## docker分层镜像
- 分层保存，联合挂载，实现镜像的复用
- 镜像结构
    - 只读层：依赖的基础镜像
    - 可读写层： 存储镜像增量信息
    - init层：用来存放/etc/*


## docker架构
- client
- daemon
    - image
    - container
    - registry

## Dockerfile
构建一个镜像的文本文件，制定了构建镜像所需的各种指令,比如 FROM COPY RUN ENV CMD ,一个指令就是一层 没有复用价值的相关命令用 && 连接，让其保持在一层

## docker仓库
- docker hub
- 国内代理
- 公司私服

- Volume挂载
使用-v将宿主机的目录挂载到容器中，如输出日志等

## docker网络
- bridge
    - 使用docker0 bridge，每个容器有独立虚拟网卡，端口不冲突
- host
    - 直接使用宿主机网卡
- container
    - 使用其他container的网络，也就是加到其他container的net ns中
- none
    - 不使用网络

## docker compose
服务编排，批量启动一个project下的所有容器，一般用本地搭建测试环境
