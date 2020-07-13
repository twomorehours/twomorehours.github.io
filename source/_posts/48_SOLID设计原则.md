---
title: SOLID设计原则
date: 2019-07-18 21:30:39
categories:
- 程序设计
---

## Single Responsiblity Principle 
单一职责原则
这个很好理解，一个模块，一个类就完成一类事，比如一个Json解析类就别管Xml的事了
优点就是职责清晰


## Open Close Principle
开闭原则
- 对扩展打开
- 对修改关闭
意思就是程序在设计之初就要充分考虑扩展性的问题，当遇到新的需求时，不用修改原来的代码，而是扩展原来的接口即可 比如实现一个阈值报警的类，这里的阈值一定是会频繁增删修的，那么这个阈值就应该抽象出来，到时候实现接口就可以了
优点是不用修改之前的基础代码，保证了代码的稳定性

## Liskov Substitution Principle
里氏替换原则
子类能在任何情况下替换父类，但是不能修改父类的行为，只能进行增强
比如增强一个排序算法
多态是实现里氏替换的基础，但是不是所有多态都符合LSP
优点不容易出现bug


## Interface Segregation Principle
接口分离原则
这个和单一职责原则比较像，指导思想是不让调用方接受不需要的接口，也不需实现方实现不需要的接口
一个接口只完成一类事情，一个函数只完成一个事情
优点是代码通用，复用能力强

## Dependency Inversion Principl
依赖倒转原则
高层的模块不应该依赖底层的模块，而是应该依赖一个共同的抽象
比如 Tomcat之于Spring Spring之于业务代码
高层模块一般指框架或者容器，一般是流程的最终控制方
优点是复用能力强


## 补充
IOC： Inversion Of Contron 
- IOC是一种思想，就是本来我们自己控制的流程，现在交到框架的手中去控制，我们只需要提供必要的信息
DI： Dependency Injection
- DI是一种技术实现，程序运行过程中注入我们需要的依赖，是spring ioc的技术实现手段

spring IOC 就是通过DI实现的
