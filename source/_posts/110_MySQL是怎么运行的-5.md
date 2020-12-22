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