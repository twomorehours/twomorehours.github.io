---
title: Mysql的查询入门
date: 2020-03-20 23:30:39
categories:
- MySQL
tags:
---

## 索引的查询的type
- const
  - 唯一索引的等值查询
- ref
  - 非唯一索引的的等值查询
- range
  - 索引范围查询
- index
  - 全索引扫描(适用于联合索引覆盖，但是未使用左前缀原则)
- all
  - 全表扫描
- index_merge
  - Intersection
    - 多个索引取交集。因为索引是有序的，所以取交集很快，取交集之后可以减少回表次数。
  - Union
    - 多个索引取并集。因为索引是有序的，所以取并集也很快，取并集之后也可以减少回表次数。