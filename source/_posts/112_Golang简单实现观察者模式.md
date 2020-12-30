---
title: Golang简单实现观察者模式
date: 2021-02-05 23:30:39
categories:
- Golang
tags:
- 观察者
---

## 观察者模式的用途
观察者模式最典型的用途就是`主流程`和`外部流程`的解耦，比如下订单要赠送一些礼品，那么下订单就是主流程，赠送礼品就是外部流程，如果把所有流程都写到下单中，下单的逻辑就会非常的长，不利于阅读，所以将这些流程单独抽出去

## 观察者模式的实现
```golang
package utils

// Observer 观察者
type Observer interface {
	Update(*Observable, interface{})
}

// Observable 被观察者
type Observable struct {
	observers []Observer
}

// NewObservable 新建一个被观察者
func NewObservable() *Observable {
	return &Observable{}
}

// Attach 增加一个观察者
func (o *Observable) Attach(observer Observer) {
	for _, obs := range o.observers {
		if obs == observer {
			return
		}
	}
	o.observers = append(o.observers, observer)
}

// Dettach 删除一个观察者
func (o *Observable) Dettach(observer Observer) {
	index := -1
	for i, obs := range o.observers {
		if obs == observer {
			index = i
			break
		}
	}
	if index == -1 {
		return
	}
	o.observers = append(o.observers[:index], o.observers[index+1:]...)
}

// Notify 通知被观察者
func (o *Observable) Notify(arg interface{}) {
	for _, obs := range o.observers {
		// 缩小作用域 某个观察者失败不影响其他观察者
		go func(obs Observer) {
			defer recover()
			obs.Update(o, arg)
		}(obs)
	}
}
```

## 使用示例
```golang
package utils

import (
	"fmt"
	"testing"
	"time"
)

type ObsA struct {
	a int // 加这个是为了让对象分配到不同的内存 如果不加 所有的空对象都是分配到相同的地址
}

func (o *ObsA) Update(observable *Observable, arg interface{}) {
	fmt.Println("Obs1", arg)
}

type ObsB struct {
	a int // 同上
}

func (o *ObsB) Update(observable *Observable, arg interface{}) {
	fmt.Println("Obs2", arg)
}

// 输出
// Obs1 abc
// Obs2 abc
// ========
// Obs2 abc

func TestObs(t *testing.T) {
	observable := NewObservable()
	var obsa1 ObsA
	var obsb1 ObsB

	// 去重
	observable.Attach(&obsa1)
	observable.Attach(&obsa1)
	observable.Attach(&obsb1)
	observable.Attach(&obsb1)

	observable.Notify("abc")

	// 等待执行完
	time.Sleep(1 * time.Second)

	// 删除
	observable.Dettach(&obsa1)

	fmt.Println("========")
	observable.Notify("abc")

	// 等待执行完
	time.Sleep(1 * time.Second)
}
``` 