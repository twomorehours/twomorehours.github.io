---
title: InnoDB数据页结构
date: 2020-03-15 23:30:39
categories:
- MySQL
tags:
- InnoDB
- 页
- COMPACT
- DYNAMIC
- COMPRESSED
---

## 什么是数据页
页是InnoDB中磁盘和内存交互的基本单位，也是InnoDB管理存储空间的基本单位，默认大小是16K

## COMPACT格式
变长字段列表|NULL值列表|记录头信息|列1的值|列2的值|...|列N的值|DB_ROW_ID(可能没有)|DB_TRX_ID|DB_ROLL_PTR
- 变长字段列表
  - 记录长度(字节数)可变的字段的所占的自己数大小，主要是VARCHAR和CHAR(虽然字符数目固定，但采用UTF8编码时，字节数不固定)
- NULL值列表
  - 记录可为NULL的字段是否为NULL(一个bit代表一个字段)，字段为NULL不占用其他空间
- 记录头信息
  - 记录删除标记，下一条记录的位置等信息
- 记录值
  - 记录各个字段的值
- DB_ROW_ID
  - 如果表中没有设置主键，并且没有唯一索引时，Mysql会自动生成一个字段DB_ROW_ID作为主键
- DB_TRX_ID
  - 记录这条记录正在被那个事物修改，用于MVCC
- DB_ROLL_PTR
  - 回滚指针，如果事物呗回滚，回滚指针指向的是未修改的数据

## 溢出页
如果一个字段的数据量特别大(8K+), 那么这个字段极有可能会被保存到溢出页中，原来的数据页保存的是前部分字节和指向溢出页的指针

## DYNAMIC格式和COMPRESSED模式
- DYNAMIC(mysql 5.7+默认)
  - 和COMPACT基本一致，唯一的区别就是在处理溢出页时记录中保存的仅是指向溢出页的指针，而不保存部分数据
- COMPRESSED
  - 和DYNAMIC基本一致，唯一的区别是保存溢出页时候采用压缩算法进行压缩

## MySQL数据页的构成
MySQL存放真实数据的叫做数据页
- File Header
存放页的一些通用信息，包括前页和后页的指针，所有页形成一个双向链表
- Page Header
存放数据页的的一些专有信息，比如Free Space的位置等
- Infinum + Suprenum
两个虚拟记录，分别表示本页的最小数据和最大数据
- User Records
真实的数据，每条数据就是上面说的格式，里面存放这下一条数据的位置，所有记录按照主键顺序形成一个单链表，物理顺序不一定是有序的
- Free Space
Page里面未被使用的空间，有新数据插入时如果没有可复用的空间，会使用这部分空间，使用的空间就变为User Records
- Page Directory 
记录页中每组数据中最大数据（按照单链表顺序，也叫主键顺序）相对位置，存成一个数组，当查询这个页中的某个数据的时候，先对数组进行二分查找，找到所属的组，然后遍历组中的数据取出想要的数据，时间复杂度接近O(logN)
- File Tailer
存储数据校验信息