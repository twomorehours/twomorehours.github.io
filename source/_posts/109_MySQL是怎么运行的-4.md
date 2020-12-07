---
title: Mysql的数据目录
date: 2020-03-20 23:30:39
categories:
- MySQL
---

## Mysql数据目录结构
- Mysql的数据目录存储在变量`datadir`中
- 每个数据库有一个文件夹
- 文件夹中存放的是.frm(表结构)和.ibd(表数据), Mysql8以后都合并到.ibd中了
- 其他文件
  - 服务器进程文件
  - 服务器日志文件
  - SSL和RSA证书文件

## Mysql自带的数据库
- mysql
  - 存储用户信息，mysql自身的配置信息
- information_schema
  - 存储表的一些元数据，有哪些列，有哪些索引等
- performance_schema
  - 保存一些mysql运行期间的状态信息，是对mysql服务器的一个性能监控
- sys
  - 这个数据库通过把information_schema和performance_schema通过视图组合起来，更方便的查询性能信息