---
title: 每天都在用的ArrayList
date: 2019-01-25 23:30:39
categories:
- 数据结构与算法
tags:
- 数组
- 随机查找
---

## ArrayList的本质是什么
- ArrayList的本质就是本部有一个数组
- 如果存储的元素超出了数组的大小，数组就会扩容，并且把原来的元素复制进去
- 如果数组的元素少过一个阈值，数组的长度还会进行相应的缩减，并且把原来的元素复制进去


## ArrayList的构造
- 无参构造
```java
public ArrayList() {
    // 默认空参内部就是一个空数组 这个对象是共享的
    // 增加第一个元素的时候 这个数组会被替换一个长度为10的数组
    this.elementData = DEFAULTCAPACITY_EMPTY_ELEMENTDATA;
}
```

- 初始长度构造
```java
public ArrayList(int initialCapacity) {
    if (initialCapacity > 0) {
        // 初始化一个长度为initialCapacity的数组
        this.elementData = new Object[initialCapacity];
    } else if (initialCapacity == 0) {
        this.elementData = EMPTY_ELEMENTDATA;
    } else {
        throw new IllegalArgumentException("Illegal Capacity: "+
                                            initialCapacity);
    }
}
```

## 添加一个元素(O(1))
```java
//java.util.ArrayList#add(E)
public boolean add(E e) {
    // 确保数组空间够大 最少也得是size+1
    ensureCapacityInternal(size + 1);  // Increments modCount!!
    // 加进去
    elementData[size++] = e;
    return true;
}
private void ensureCapacityInternal(int minCapacity) {
    // 确保一个计算出来的容量
    ensureExplicitCapacity(calculateCapacity(elementData, minCapacity));
}
private static int calculateCapacity(Object[] elementData, int minCapacity) {
    // 如果是空参构造的默认数组
    if (elementData == DEFAULTCAPACITY_EMPTY_ELEMENTDATA) {
        // 那么长度就是 max(10,size+1) 一般就是10
        return Math.max(DEFAULT_CAPACITY, minCapacity);
    }
    // 否则就是返回size+1
    return minCapacity;
}
private void ensureExplicitCapacity(int minCapacity) {
    modCount++;

    // overflow-conscious code
    // 需要扩展
    if (minCapacity - elementData.length > 0)
        // 扩展
        grow(minCapacity);
}
 private void grow(int minCapacity) {
    // overflow-conscious code
    // 当前容量
    int oldCapacity = elementData.length;
    // 扩展1.5倍
    int newCapacity = oldCapacity + (oldCapacity >> 1);
    // 如果扩展之后还不够大或者溢出了
    if (newCapacity - minCapacity < 0)
        // 就采用传入的最小值 
        newCapacity = minCapacity;
    // 如果已经到了最大
    if (newCapacity - MAX_ARRAY_SIZE > 0)
        // 就设置一个最大值 基本不会发生
        newCapacity = hugeCapacity(minCapacity);
    // minCapacity is usually close to size, so this is a win:
    // 将数据拷贝到新数组中 并返回新数组
    elementData = Arrays.copyOf(elementData, newCapacity);
}
```

## 根据索引删除一个元素(O(n))
```java
public E remove(int index) {
    // 检查传入的索引是否超出了size
    rangeCheck(index);

    modCount++;
    // 取出旧元素
    E oldValue = elementData(index);
    // 将这个元素后面的元素整体前移 
    int numMoved = size - index - 1;
    // 整体前移元素
    if (numMoved > 0)
        System.arraycopy(elementData, index+1, elementData, index,
                            numMoved);
    // 将最后一位元素置空（已经向前移动一位了）
    elementData[--size] = null; // clear to let GC do its work

    // 返回旧元素
    return oldValue;
}
```

## 根据元素本身删除一个元素(O(n))
```java
public boolean remove(Object o) {
    if (o == null) {
        for (int index = 0; index < size; index++)
            // 找到元素索引
            if (elementData[index] == null) {
                // 删除元素
                fastRemove(index);
                return true;
            }
    } else {
        for (int index = 0; index < size; index++)
            // 找到元素索引
            if (o.equals(elementData[index])) {
                // 删除元素
                fastRemove(index);
                return true;
            }
    }
    return false;
}
// fastRemove 和根据索引删除元素的流程一样
private void fastRemove(int index) {
    modCount++;
    int numMoved = size - index - 1;
    if (numMoved > 0)
        System.arraycopy(elementData, index+1, elementData, index,
                            numMoved);
    elementData[--size] = null; // clear to let GC do its work
}
```

## 查找一个元素(O(n))
```java
//java.util.ArrayList#indexOf
public int indexOf(Object o) {
    if (o == null) {
        for (int i = 0; i < size; i++)
            // 遍历查找
            if (elementData[i]==null)
                return i;
    } else {
        for (int i = 0; i < size; i++)
            // 遍历查找
            if (o.equals(elementData[i]))
                return i;
    }
    return -1;
}
```

## 根据索引取元素(O(1))
```java
public E get(int index) {
    // 确认索引没越界
    rangeCheck(index);

    // 直接取
    return elementData(index);
}
```

## 迭代
```java
public Iterator<E> iterator() {
    return new Itr();
}
private class Itr implements Iterator<E> {
    // 下一个返回的元素
    int cursor;       
    // 当前返回的元素 用于删除
    int lastRet = -1; 
    // 修改次数 用于判断是否在遍历过程中发生过修改
    int expectedModCount = modCount;

    Itr() {}

    public boolean hasNext() {
        // 判断没有遍历结束
        return cursor != size;
    }

    @SuppressWarnings("unchecked")
    public E next() {
        // 减产修改次数
        checkForComodification();
        int i = cursor;
        if (i >= size)
            throw new NoSuchElementException();
        Object[] elementData = ArrayList.this.elementData;
        if (i >= elementData.length)
            throw new ConcurrentModificationException();
        // 指向下一个
        cursor = i + 1;
        // lastRet指向当前返回元素
        return (E) elementData[lastRet = i];
    }

    public void remove() {
        if (lastRet < 0)
            throw new IllegalStateException();
        checkForComodification();

        try {
            // 按照索引删除
            ArrayList.this.remove(lastRet);
            // cursor指向新移动过来的元素
            cursor = lastRet;
            lastRet = -1;
            // 更新expectedModCount
            expectedModCount = modCount;
        } catch (IndexOutOfBoundsException ex) {
            throw new ConcurrentModificationException();
        }
    }
}
```

## 总结
- ArrayList的本质是内有有一个数组
- 添加元素的复杂度O(1)
- 删除元素复杂度O(n)
- 根据索引获取元素复杂度O(1)
- 根据元素查找index复杂度O(n)
- 所以ArrayList，适用于根据index取，不适用于删除
- 迭代时不能不能使用list增删，应该使用迭代器进行增删