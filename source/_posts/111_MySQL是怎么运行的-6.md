---
title: Mysql的事务
date: 2020-04-05 23:30:39
categories:
- MySQL
tags:
- ACID
---

## 什么叫做事务
需要保证事务四大特性的一个或者多张个数据库操作叫做事务

## 事务的四大特性
- Atomic(原子性)
  - 所有操作，要么全部成功，要么全部失败
- Consistent(一致性)
  - 不违反显示世界的规律，比如AB转账前后的总额是不变的
- Isolation(隔离性)
  - 不同的事务之间不应该互相干扰
- Durability(持久性)
  - 已经提交的事务要一直存在

## Mysql事务的使用
- 自动提交事务
  - Mysql是默认自动提交事务的，即使没有显示开启事务，当执行一条语句时也是默认开启并且提交事务
- 手动事务
  - 当要批量执行操作的时候就需要手动开启事务，使用`begin`， 全部执行成功后使用`commit`提交，或者失败情况下使用`rollback`回滚 

## Mysql如何保证事务的持久性
- 保证持久性就是保证Mysql崩溃后，提交的数据不丢失，这就要求提交的数据必须写在磁盘上，但是每次提交都刷写磁盘（随机IO）性能太低，所以Mysql引入了redo log来保证事务的持久性
- redolog的写入
  - 开启事务
  - 修改buffer pool ，修改页的控制块加入flush链表
  - 提交事务
  - 操作的数据写入redo log buffer（这步实际上是有可能丢失数据的）
  - 后台数据将buffer的数据顺序刷写到磁盘上
- redo log保存了什么
  - redo log保存了修改的物理信息，即页号加数据
- redo log怎么使用
  - mysql在异常恢复的时候，会读取redo log的数据重放
- redo log的特征
  - redo log 是循环的 如果要写满了 要强制刷写到数据页
  - redo log很小
  - redo log是分组的，一个影响多条数据的操作会分到一组，这一组保存或者重放时是原子的

## 回滚如何实现
- Mysql在事务操作的时候会保存被修改之前的数据，这样的记录叫做undo log
- undo log可以有多个，根节点是数据的上的roll_pointer, 越新的undo log越靠近roll pointer
- 插入的undo log保存的是插入的id 回滚时直接删除此id
- 更新的undo log保存的是修改了哪些字段的数据
- undo log不能提交之后立即删除，因为MVCC的原因，有可能有些读事务还在引用undo log(快照读的时候，写事务还没有结束)