---
title: Mysql的查询优化
date: 2020-03-20 23:30:39
categories:
- MySQL
tags:
- 连接
---

## Mysql的执行计划生成
Mysql会计计算各种条件下产生代价，并选择代价最小的方式执行，代价主要包括两种，IO和CPU
- 根据查询条件，找出所有可能使用的索引
- 计算全表扫描的代价
  - IO代价：分页数(每页16K) * 1
  - CPU代价：记录数(估算) * 0.2
- 计算使用不同索引的代价
  - IO代价：索引扫描区间条数（估算） * 1(每个索引算一页，算回表)
  - CPU代价：索引扫描区间条数（估算） * 0.2
- 比较得出代价最小的

## Mysql的统计数据
Mysql在执行期间会动态生成一些统计数据，这些数据就是生成执行计划的基础，这写数据会在数量变化大的时候自动后台更新
- innodb_table_stats
  - database_name 数据库名
  - table_name 表名
  - last_udpate 最后更新时间
  - n_rows 表中的记录数 估计值 选择几个页面求出平均值 然后乘以所有的叶子节点页面
  - clustered_index_size 聚簇索引占用的页面数量
  - sum_of_other_index_size 其他索引占用的页面数量
- innodb_index_stats
  - database_name 数据库名
  - table_name 表名
  - index_name 索引名
  - last_udpate 最后更新时间
  - stat_name 统计项的名称 一个索引有多个统计项
  - stat_value 对应统计项的值
  - sample_size 为了生成统计数据采样的页面数量
  - stat_description 对用的统计项的描述

## Mysql对查询语句的重写
Mysql为了提升查询性能，会按照以下规则进行重写SQL
- 移除不必要的括号
- 常量传递 会把已经赋值的变量替换成常量
- 移除没用的条件 1=1 等
- 表达式计算 a= 1 + 1 => a=2
- HAVING子句和WHERE子句合并 HAVING后面如果不是聚合函数等依赖分组结果相关的过滤条件都会移动到WHERE后面 可以减少参与分组的数据量 提升分组速度

## Explain各项的解释
- id
  - 每个select会有一个id 连接查询会有相同的id
- select_type
  - SIMPLE 
    - 简单查询 没有子查询和union 连接查询也是SIMPLE
  - PRIMARY 
    - 子查询 union情况下最左边的查询
  - UNION 
    - union查询靠后面的查询
  - UNION RESULT 
    - union时自动生成的用于去重的查询
  - SUBQUERY
    - 子查询
- type
  - const
    - 对主键或者唯一二级索引的等值查询
  - eq_ref
    - 连接查询时，被驱动表的连接条件是主键或者是不允许NULL的唯一二级索引
  - ref
    - 对普通的二级索引的等值查询
  - index_merge
    - 索引合并，同时使用多个索引，取交集或者并集，来减少回表次数
  - range
    - 对索引进行范围查询
  - index
    - 全索引扫描 当能够使用索引覆盖，但是使用的不是前导列索引，不能形成扫描范围时，需要对索引进行全部扫描，不需要回表
  - all
    - 全表扫描
- possible_keys & keys
  - possible_keys
    - 可能使用的索引
  - keys
    - 将会使用的索引
  - key_len
    - 使用的索引长度 就是索引列类型所占的长度
    - 索引列支持NULL +1字节
    - 索引列长度可变 +2字节
    - 这个主要是看联合索引道理使用了哪些前导列 key_len是前导列的长度相加
- ref
  - 描述和某某列等值匹配的是什么
  - const 常量
  - 其他的表的字段 连接查询时使用
  - func 匹配的值是函数
- rows
  - 从存储引擎返回给server层的数量（估计）
- filtered
  - server层过滤之后还剩多少条 （估计）
- Extra
  - Using Index
    - 索引覆盖 不用回表
  - Using index condition
    - 联合索引中前导列使用了模糊匹配或者范围匹配，后面的索引列不能形成扫描范围，这个时候就会采用逐个过滤相关索引，以减少回表 也成为索引下推
  - Using where
    - 当某个条件需要在server层进行判断的时候 会显示这个  比如从某个索引取出数据后还需要过滤另外一个字段 这个字段不在刚才的索引中
  - Using join buffer 
    - 连接查询时， 当使用BNL算法时，会一次从驱动表中取出一个批次的数据 和被驱动表进行匹配 减少IO 提升性能
  - Using Temporary
    - 在查询过程去使用了临时表 最常见的场景就是对没有索引的字段进行group 一般需要优化
  - Using filesort
    - 文件内排序 最常见的场景就是使用没有索引的字段进行排序 并且数据量比较大 内存放不下 一般需要优化

## InnoDB Buffer Pool
InnoDB Buffer Pool是innoDB的内存部分，用来缓存数据页
- 构成
  - Buffer Pool由控制块和缓冲页组成， 控制块用来维护链表，控制块中持有缓冲液的地址， 缓冲页用来保存数据页的数据
- 空闲链表
  - Free list 用来维护buffer pool中可以被使用的缓冲页，链表中的节点是控制块
- 脏页
  - 内存中数据更改了，但是还没有刷新到磁盘上，因为每次都刷新到磁盘上很慢，大多数情况下都是后台线程刷新到磁盘上，维护这些脏页的是Flush list
- LRU链表
  - 缓存的数据不能无限的多，当内存到达上限之后，就淘汰最久没被使用的数据
  - 这个链表是分段链表
    - young部分： 存放访问频率高的数据
    - old部分：存放新加载到缓存的数据，之后数据再次被访问时在内存中已经超过了1s，才会被移动到young
    - 这种设计是为了避免让大量的使用频率低的数据（如全表扫描）将真正的热数据挤出去
- hash表
  - 判断一个页是否加载到buffer pool中就以表空间号+页号为key取控制块
- show engine innodb status可以查看一些buffer pool的运行时统计数据
  - Total large memory allocated： 已经分配的内存
  - Buffer pool size ： Buffer pool的大小 以页为单位
  - Free buffers： 空闲链表的长度
  - Database pages： LRU链表的长度
  - Old database pages LRU链表old部分的长度
  - Modified db pages  FLush list长度
