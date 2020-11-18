---
title: MySQL是怎么运行的学习笔记-入门
date: 2020-03-11 23:30:39
categories:
- MySQL
tags:
- mysqld
- tcp
- unix socket
- 查询缓存
- 存储引擎
- 运行时变量
---

## 服务端组成
- mysqld是mysql服务端程序
- mysqld_safe是mysqld的监控程序(shell脚本)，用于在mysqld挂了之后重新启动
- mysql.server是是mysqld_safe的进一步封装(shell脚本)，用于更加便利的启停mysql
- ...

## 客户端组成
- mysql是客户端命令行程序
- mysqldump是导出导入数据的程序
- ...

## 通信方式
- 未指定ip时，默认以unix socket(/tmp/mysql.sock)的形式与本地的server进行通信
- 指定ip时间，用tcp进行通信

## 客户端请求处理流程
- 连接管理
服务端每收到一个客户端连接时间就会新建一个线程处理这个连接，也就是非I/O多路复用的模式，这个步骤还包括鉴权
- 解析与优化
  - 查询缓存：
    mysqlserver会以查询语句为key，缓存查询的结果，必须完全相同的语句才能命中缓存，并且语句中不能有系统函数，因为系统函数执行多次的结果可能不一样(比如now()), 每当某个表执行DDL或者DML时，这个表的所有缓存就会被清除，所以这个缓存命中概率低，还要使用大量资源取维护，官方不推荐使用了
  - 语法解析：
    server会解析SQL语句然后将各种查询条件提取出来构建成运行时的数据结构
  - 查询优化：
    连接转换，子查询转换，策略选择等
  - 存储引擎：
    存储引擎把server需要的数据（经过索引过滤的）逐条返回给server ，server经过剩余的where条件过滤后返回给客户端

## 存储引擎
主要的就是两种InnoDB，MyISAM， 现在绝大多数情况下都使用InnoDB，因为其支持行锁，支持事务和Mvcc，我们可以在创建表的时候指定存储引擎，如果不指定则使用server默认的配置

## 配置文件
mysql的配置文件为my.cnf，配置文件中可以指定一些mysql运行时的变量，配置文件分为多个组，mysqld、mysql、server、client等，server组所有的服务端相关的程序（mysqld,msyqld_safe等）都会读取，优先级最低，client是所有客户端(mysql,mysqladmin等)程序读取，优先级也是最低

## 启动选项
mysql启动时可以通过参数指定一些运行时参数，如最大连接数等，此处指定的优先级高于配置文件，只是本次启动生效

## 运行时变量设置
mysqlserver可以在运行时设置一些变量，变量分为两种，全局和会话
- 全局变量(GLOBAL)
    mysqlserver全局的变量，会所有会话生效，但是全局变量被修改是不会对除发起本次修改之外的已经存在会话生效
- 会话变量(SESSION)
    会话级别的变量，server会为每个client维护一份session变量，生命周期和session生命周期一致，修改时不会修改其他session和全局变量

## 状态变量
mysqlserver在运行期间有一些状态，这些状态只读
```text
// 展示线程相关的状态
mysql> show status like 'thread%';
+-------------------+-------+
| Variable_name     | Value |
+-------------------+-------+
| Threads_cached    | 1     |
| Threads_connected | 1     |
| Threads_created   | 2     |
| Threads_running   | 2     |
+-------------------+-------+
```

## Mysql的字符集
- 服务端字符集
  - server
    - 使用utf8mb4
  - database
    - 使用utf8mb4
  - table
    - 不指定默认使用database字符集，不建议指定
  - column
    - 不指定默认使用column字符集，不建议指定
- 客户端字符集
  - session
建议将server、database默认字符集配置文件中设置为utf8mb4, 客户端连接时也指定为utf8mb4,防止乱码
    