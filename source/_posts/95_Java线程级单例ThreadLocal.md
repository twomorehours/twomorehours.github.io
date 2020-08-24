---
title: Java线程级单例ThreadLocal
date: 2020-07-13 23:30:39
categories:
- 并发编程
tags:
- 单例
---



## ThreadLocal是干啥的
顾名思义，ThreadLocal可以保存线程私有的对象，解决线程安全问题，一般用于保存请求上下文，传递请求id等

## ThreadLocal的本质
ThreadLocal对象实际上是线程内部一个Map的key，真正的对象还是保存在线程内部的，通过ThreadLocal这个key可以取出来，不同的线程调用就是在不同的Map本身里面取，只是从API上看起来是从ThreadLocal中取出来的


## 设置一个值
- 取线程内部Map
```java
//java.lang.ThreadLocal#set
public void set(T value) {
    // 取当前线程
    Thread t = Thread.currentThread();
    // 取出线程内部的ThreadLocalMap
    ThreadLocalMap map = getMap(t);
    if (map != null)
        // map不为空 就是原来有其他ThreadLocal放过值
        map.set(this, value);
    else
        // map为空 先在线程内部创建一个map
        createMap(t, value);
}
```
- Map为空创建
```java
//java.lang.ThreadLocal#createMap
void createMap(Thread t, T firstValue) {
    t.threadLocals = new ThreadLocalMap(this, firstValue);
}
//java.lang.ThreadLocal.ThreadLocalMap#ThreadLocalMap(java.lang.ThreadLocal<?>, java.lang.Object)
ThreadLocalMap(ThreadLocal<?> firstKey, Object firstValue) {
    // 创建内部的数组
    table = new Entry[INITIAL_CAPACITY];
    // 第一个值的索引
    int i = firstKey.threadLocalHashCode & (INITIAL_CAPACITY - 1);
    // 放进去
    table[i] = new Entry(firstKey, firstValue);
    // 标记容量
    size = 1;
    // threshold 设置为长度的2/3
    setThreshold(INITIAL_CAPACITY);
}
```
- Map不为空插入值
```java
//java.lang.ThreadLocal.ThreadLocalMap#set
// 这里Map用的开放寻址法 非链地址法
// 就是遇到冲突的就往后找 一直找到一个没有冲突的位置
private void set(ThreadLocal<?> key, Object value) {

    Entry[] tab = table;
    int len = tab.length;
    // 计算的得到的index
    int i = key.threadLocalHashCode & (len-1);

    // 从i开始往后遍历
    for (Entry e = tab[i];
            e != null;
            e = tab[i = nextIndex(i, len)]) {
        ThreadLocal<?> k = e.get();

        if (k == key) {
            // 找到相同的进行替换
            e.value = value;
            return;
        }

        if (k == null) {
            // 这里=null 是因为对应的ThreadLocal对象被GC了 直接占用这个位置
            // 至于为什么会=null 我们放到下面再分析
            replaceStaleEntry(key, value, i);
            return;
        }
    }

    // 没有找到相同的 也没有找到可以替换的 新建一个
    tab[i] = new Entry(key, value);
    int sz = ++size;
    // 如果不能清理了数据 并且大于threshold 就要进行扩容
    if (!cleanSomeSlots(i, sz) && sz >= threshold)
        rehash();
}
```

## 获取一个值
- 取线程内部Map
```java
//java.lang.ThreadLocal#get
public T get() {
    // 取出当前线程内部的Map
    Thread t = Thread.currentThread();
    ThreadLocalMap map = getMap(t);
    if (map != null) {
        // 取出ThreadLocal对应的entry
        ThreadLocalMap.Entry e = map.getEntry(this);
        if (e != null) {
            @SuppressWarnings("unchecked")
            T result = (T)e.value;
            return result;
        }
    }
    // 否则就走初始值
    return setInitialValue();
}
```
- 根据ThreadLocal取对应的值
```java
//java.lang.ThreadLocal.ThreadLocalMap#getEntry
private Entry getEntry(ThreadLocal<?> key) {
    int i = key.threadLocalHashCode & (table.length - 1);
    Entry e = table[i];
    // 看直接计算出来的索引是不是想要的
    if (e != null && e.get() == key)
        return e;
    else
        // 没找到就要进行遍历
        return getEntryAfterMiss(key, i, e);
}
//java.lang.ThreadLocal.ThreadLocalMap#getEntryAfterMiss
private Entry getEntryAfterMiss(ThreadLocal<?> key, int i, Entry e) {
    Entry[] tab = table;
    int len = tab.length;

    while (e != null) {
        ThreadLocal<?> k = e.get();
        if (k == key)
            // 找到了 直接返回
            return e;
        if (k == null)
            // 这里=null 是因为对应的ThreadLocal对象被GC了  需要清理 细节下面再分析
            // 至于为什么会=null 我们放到下面再分析
            expungeStaleEntry(i);
        else
            // 继续遍历
            i = nextIndex(i, len);
        e = tab[i];
    }
    return null;
}
```

- 走默认值
```java
//java.lang.ThreadLocal#setInitialValue
private T setInitialValue() {
    // 回调自己实现的initialValue
    T value = initialValue();
    // 设置进去
    Thread t = Thread.currentThread();
    ThreadLocalMap map = getMap(t);
    if (map != null)
        map.set(this, value);
    else
        createMap(t, value);
    // 返回
    return value;
}
```


## 删除一个值
```java
//java.lang.ThreadLocal#remove
public void remove() {
    // 获取线程里面的Map
    ThreadLocalMap m = getMap(Thread.currentThread());
    if (m != null)
        // 移除此ThreadLocal对应的value
        m.remove(this);
}
// java.lang.ThreadLocal.ThreadLocalMap#remove
private void remove(ThreadLocal<?> key) {
    Entry[] tab = table;
    int len = tab.length;
    // 计算index
    int i = key.threadLocalHashCode & (len-1);
    // 从index开始遍历
    for (Entry e = tab[i];
            e != null;
            e = tab[i = nextIndex(i, len)]) {
        if (e.get() == key) {
            // 将对ThreadLocal引用置为空
            e.clear();
            // 清理那些没有引用的
            expungeStaleEntry(i);
            return;
        }
    }
}
```

## ThreadLocal对象被回收后线程内部的值如何删除
- 如何判断一个值对应的ThreadLocal已经被回收了
```java
//java.lang.ThreadLocal.ThreadLocalMap.Entry
// 这个Entry是对ThreadLocal的弱引用
// 弱引用的特点是 在被引用的对象存在是可以通过弱引用取到
// 弱引用不影响GC 也就是即使一个对象有弱引用 但该GC还是会被GC
// 在被引用的对象被GC后是不能通过弱引用取到
// 所以ThreadLocal对象呗GC的时候 Entry.get() 不能取到值
static class Entry extends WeakReference<ThreadLocal<?>> {
    /** The value associated with this ThreadLocal. */
    Object value;

    Entry(ThreadLocal<?> k, Object v) {
        super(k);
        value = v;
    }
}
```

- set值时清理
```java
private void set(ThreadLocal<?> key, Object value) {

    Entry[] tab = table;
    int len = tab.length;
    // 计算的得到的index
    int i = key.threadLocalHashCode & (len-1);

    // 从i开始往后遍历
    for (Entry e = tab[i];
            e != null;
            e = tab[i = nextIndex(i, len)]) {
        ThreadLocal<?> k = e.get();

        //...

        if (k == null) {
            // 这里=null 是因为对应的ThreadLocal对象被GC了 直接占用这个位置
            // 原来的value就会被回收了
            replaceStaleEntry(key, value, i);
            return;
        }
    }

    //...
}
```

- remove时清理
```java
// java.lang.ThreadLocal.ThreadLocalMap#remove
private void remove(ThreadLocal<?> key) {
    Entry[] tab = table;
    int len = tab.length;
    // 计算index
    int i = key.threadLocalHashCode & (len-1);
    // 从index开始遍历
    for (Entry e = tab[i];
            e != null;
            e = tab[i = nextIndex(i, len)]) {
        if (e.get() == key) {
            // 将对ThreadLocal引用置为空
            e.clear();
            // 清理那些没有引用的
            expungeStaleEntry(i);
            return;
        }
    }
}
//java.lang.ThreadLocal.ThreadLocalMap#expungeStaleEntry
private int expungeStaleEntry(int staleSlot) {
    Entry[] tab = table;
    int len = tab.length;

    // 将传入的直接置空
    tab[staleSlot].value = null;
    tab[staleSlot] = null;
    size--;

    // 从i开始往下清理和rehash 直到null
    Entry e;
    int i;
    for (i = nextIndex(staleSlot, len);
            (e = tab[i]) != null;
            i = nextIndex(i, len)) {
        // 如果取不到 证明已经被回收了
        ThreadLocal<?> k = e.get();
        if (k == null) {
            // 清理对应的值
            e.value = null;
            tab[i] = null;
            size--;
        } else {
            // 新的index
            int h = k.threadLocalHashCode & (len - 1);
            // 如果新老不一致
            if (h != i) {
                // 将老的置空
                tab[i] = null;

                // Unlike Knuth 6.4 Algorithm R, we must scan until
                // null because multiple entries could have been stale.
                // 寻找一个新位置
                while (tab[h] != null)
                    h = nextIndex(h, len);
                tab[h] = e;
            }
        }
    }
    return i;
}
```

- ThreadLocal会发生内存泄漏吗
    - ThreadLocal被GC后，不能保证对应的value一定会被回收，所以有发生泄漏的可能性
    - ThreadLocal会在set时和remove时对部分的值进行扫描清理，所以有发生泄漏的可能性比较低
    - ThreadLocal在项目中使用一般较小，而项目中的线程通常也不多，所以即使是泄漏，也没啥问题



## 总结
- ThreadLocal可以保存线程私有的对象，解决线程安全问题，一般用于保存请求上下文，传递请求id等
- ThreadLocal的本质是实际上是线程内部一个Map的key
- 设置一个值是将值放到线程内部的一个Map里面，key是ThreadLocal对象
- 获取一个值是从线程内部的Map取值，keyThreadLocal对象
- 删除从线程内部的Map中删除，keyThreadLocal对象
- 清理被GC的ThreadLocal关联的值发生在set寻址的时候，和remove顺序清理的时候
- 发生内存泄漏可能性很小，即使泄漏也没多少内存，开发过程中不用过度关注