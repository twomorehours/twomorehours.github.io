---
title: 不变、协变、逆变和PECS
date: 2019-09-24 18:29:26
categories: 
- Java

---

## 啥是不变
```
//以下为伪代码
class A{}
class B extends A{}

void f1(List<A> list){}
f1(Arrays.asList(B1,B2,B3)) // 这里不能编译通过，因为List<B> 不是 List<A> 的子类，这就是不变
```

## 啥是协变
```
//以下为伪代码
class A{}
class B extends A{}

void f1(List<? extends A> list){}
f1(Arrays.asList(B1,B2,B3)) // 这里可已编译他通过，因为List<B> 是 List<? extends A> 的子类，这就是协变
很明显协变要解决的问题就是参数的复用问题 好处就是不用手动把List<B>转成List<A>（这里强转是不行的）
如果还有List<C>、List<D> 效果就会更明显，就是不管你传进来是什么子类，我都当做A使用
总结一下：如果B extends A 那么 C<B> extends C<A> 开启协变的方式就是 ? extends
下面来说说PECS中的PE P是指producer E是指extends 意思就说producer要采用extends 
这是啥意思呢
比如f1的实现是从list里面取值，那么list就是提供方，用来提供A,这种东西就叫producer ,声明的时候就要用 extends
```

## 啥是逆变
```
//以下为伪代码
class A{}
class B extends A{}
class C extends B{}

void f1(List<? super C> list){list.add(C)}
f1(List<A>) // 能编译过
f1(list<B>) // 能编译过

逆变要解决的问题和协变基本一样就是参数的复用，不一样的地方是逆变接受的东西叫consumer ，就是我只接受东西，不管你放什么，我都当做我声明的List<A>或者list<B>

总结一下：如果B extends A 那么 C<A> extends C<B> 开启协变的方式就是 ? super
这也就是PECS中的consumer super的意义
```
