---
title: Golang中的单例实现-Once
date: 2021-02-10 23:30:39
categories:
- Golang
tags:
- 单例
---

## 什么是单例
单例默认指的是进程内单例，也就是一个进程中某个类型仅有一个对象，单例一般有两种实现方式，预先加载和懒加载，今天要说的Once就是懒加载

## 执行过程
流程就是Java Double Check的翻版
- 判断状态，如果为0，可以继续执行，否则表示已经初始化完成
- 加锁
- 再次判断，因为可能不是第一个获取到锁的
- 执行完成，改状态
- 到此为止，后面的请求再第一步判断状态后都不不用执行了，也无需加锁

## 代码实现
```golang
package sync

import (
	"sync/atomic"
)

type Once struct {
  // 标记这个Once是否已经执行过了 
  done uint32
  // 执行时候的锁 只能串行 执行的时候其他协程需要等待
	m    Mutex
}

// 外部执行API
func (o *Once) Do(f func()) {
  // 如果标记为0的时候 可以执行 
  // 如果标记为1的时候 不能执行
	if atomic.LoadUint32(&o.done) == 0 {
		// Outlined slow-path to allow inlining of the fast-path.
    // 如果可以执行 加锁执行逻辑
    // 加锁是因为只能串行 且没执行完的时候（状态不是1） 
    // 外面的协程只能等待 否则可能会得到未初始化完成的结果
    o.doSlow(f)
	}
}

// 加锁执行内部逻辑
func (o *Once) doSlow(f func()) {
	o.m.Lock()
  defer o.m.Unlock()
  // 获取到锁之后再次判断
  // 因为这个协程可能不是第一个获取到锁的
	if o.done == 0 {
    // 业务逻辑执行完成后 将状态改成1 这样后面再次调用直接判断状态就行了 不需要加锁
		defer atomic.StoreUint32(&o.done, 1) 
		f()
	}
}
```