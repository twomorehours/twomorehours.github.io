---
title: 每天都在用的HashMap
date: 2020-01-01 23:30:39
categories:
- 数据结构与算法
tags:
- HashMap
- 哈希表
- 二叉树
- 时间复杂度
- 哈希算法
---

## 基本数据结构
HashMap的基本数据是数组加链表(二叉树的主要实现也是链表)，这是一个Java程序必须知道的事情
```text
        [o]  [ ]  [o]  [o] 
         |             / \
         o            o   o
         |           /\   /\          
         o          o o  o  o
         |
         o
```

## HashMap内部节点的数据结构
```java
static class Node<K,V> implements Map.Entry<K,V> {
    // key的hash
    final int hash;
    final K key;
    V value;
    // 指向链表中的下一个节点
    Node<K,V> next;

    Node(int hash, K key, V value, Node<K,V> next) {
        this.hash = hash;
        this.key = key;
        this.value = value;
        this.next = next;
    }

    public final K getKey()        { return key; }
    public final V getValue()      { return value; }
    public final String toString() { return key + "=" + value; }

    //node的hashcode
    public final int hashCode() {
        return Objects.hashCode(key) ^ Objects.hashCode(value);
    }

    // 设置一个新值
    public final V setValue(V newValue) {
        V oldValue = value;
        value = newValue;
        return oldValue;
    }

    // 是同一个对象
    // 或者 key相等value也相等
    public final boolean equals(Object o) {
        if (o == this)
            return true;
        if (o instanceof Map.Entry) {
            Map.Entry<?,?> e = (Map.Entry<?,?>)o;
            if (Objects.equals(key, e.getKey()) &&
                Objects.equals(value, e.getValue()))
                return true;
        }
        return false;
    }
}
```

## HashMap的构建
- 空参构造
```java
//java.util.HashMap#HashMap()
public HashMap() {
    // 设置默认负载因子 0.75
    // 里面的数组是延迟初始化的 在put第一个元素的时候初始化
    // 默认数组长度是16
    // 负载因子的作用是 当（map内的元素个数 >= 数组长度 * 负载因子）时 数组应该扩容 来减小hash碰撞的几率
    this.loadFactor = DEFAULT_LOAD_FACTOR; // all other fields defaulted
}
```

- 初始化长度构造
```java
//java.util.HashMap#HashMap(int)
public HashMap(int initialCapacity) {
    this(initialCapacity, DEFAULT_LOAD_FACTOR);
}
//java.util.HashMap#HashMap(int, float)
public HashMap(int initialCapacity, float loadFactor) {
    //...                 
    // 默认负载因子              
    this.loadFactor = loadFactor;
    // 这个threshold就表示 当前数组长度 * 负载因子 
    // 在插入过程中判断元素个数是否大于这个数 如果大于便扩容
    // 但是此时这个字段还有另外一个作用 那就是保存数组的初始化长度 当延迟初始化完成之后 这个字段就没有这个作用了
    // 下面这个计算是把传入的长度规划成大于等于传入值的2的n次方
    // 之所以这么计算有两个原因 
    //      1.定位 hash & (length -1) 
    //        length -1 之后二进制低位全是1 这样就能保证hash的散列性不被破坏 也就是说具体的位置取决于hash
    //      2.扩容时扩容成2倍 不需要rehash
    //          分析扩容时再解释
    this.threshold = tableSizeFor(initialCapacity);
}
// 返回大于等于cap的2的n次方
// 感兴趣的可以研究一下
static final int tableSizeFor(int cap) {
    int n = cap - 1;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    return (n < 0) ? 1 : (n >= MAXIMUM_CAPACITY) ? MAXIMUM_CAPACITY : n + 1;
}
```

## 插入元素
```java
//java.util.HashMap#put
public V put(K key, V value) {
    // onlyIfAbsent： false 没有才插入 
    // evict: 给LinkedHashMap用的 删除最老的元素（LRU）
    return putVal(hash(key), key, value, false, true);
}
//java.util.HashMap#hash
static final int hash(Object key) {
    int h;
    // 为null就是0
    // 否则是hashcode的低16位 ^ 高16位
    // 这么做是因为 length-1一般到不了16位 所以计算index的时候都是用的低16位
    // 如果两个数的低16位相同就会发生碰撞 
    // 引入了这个机制后 如果高16位不一样也能避免碰撞
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
//java.util.HashMap#putVal
final V putVal(int hash, K key, V value, boolean onlyIfAbsent,
                   boolean evict) {
    // 底层的数组
    Node<K,V>[] tab; Node<K,V> p; int n, i;
    // 这种就是延迟初始化数组
    if ((tab = table) == null || (n = tab.length) == 0)
        // resize() 有初始化的功能  我们放后面分析
        n = (tab = resize()).length;
    // 如果对应的位置还没有值 那么就直接进去作为链表头结点
    if ((p = tab[i = (n - 1) & hash]) == null)
        tab[i] = newNode(hash, key, value, null);
    else {
        // 如果原来的位置有值 
        Node<K,V> e; K k;
        // 判断头节点的key是不是和这个相同
        // 相同直接替换
        if (p.hash == hash &&
            ((k = p.key) == key || (key != null && key.equals(k))))
            e = p;
        else if (p instanceof TreeNode)
            // 如果已经是二叉树了 就调用二叉树的api插入
            e = ((TreeNode<K,V>)p).putTreeVal(this, tab, hash, key, value);
        else {
            // 这里就要遍历列表了
            // binCount 是记录节点的个数
            for (int binCount = 0; ; ++binCount) {
                if ((e = p.next) == null) {
                    // 如果遍历到最后了 那就加入一个新节点
                    p.next = newNode(hash, key, value, null);
                    if (binCount >= TREEIFY_THRESHOLD - 1) // -1 for 1st
                        // 如果链表长度大于7 就把链表转为二叉树
                        treeifyBin(tab, hash);
                    break;
                }
                // 如果在链表中碰见key一样的了 就停止遍历
                if (e.hash == hash &&
                    ((k = e.key) == key || (key != null && key.equals(k))))
                    break;
                p = e;
            }
        }
        // 如果有一样的
        if (e != null) { // existing mapping for key
            V oldValue = e.value;
            // 如果没有设置必须存在 或者 值为空
            if (!onlyIfAbsent || oldValue == null)
                // 就替换原来的值 并且把新的值替换进去
                e.value = value;
            // 回调模板方法 这里一般是linkedhashMap使用
            afterNodeAccess(e);
            // 返回旧值
            return oldValue;
        }
    }
    // 新插入了值
    ++modCount;
    // 如果size大于threshold 就扩容
    // 逻辑后面分析
    if (++size > threshold)
        resize();
    // 回调模板方法 这里一般是linkedhashMap使用
    afterNodeInsertion(evict);
    return null;
}
```

## 查询元素
```java
//java.util.HashMap#get
public V get(Object key) {
    Node<K,V> e;
    return (e = getNode(hash(key), key)) == null ? null : e.value;
}
//java.util.HashMap#getNode
final Node<K,V> getNode(int hash, Object key) {
    Node<K,V>[] tab; Node<K,V> first, e; int n; K k;
    if ((tab = table) != null && (n = tab.length) > 0 &&
        (first = tab[(n - 1) & hash]) != null) {
        // 如果头节点和key相等 就直接返回头结点
        if (first.hash == hash && // always check first node
            ((k = first.key) == key || (key != null && key.equals(k))))
            return first;
        if ((e = first.next) != null) {
            // 如果是树 就从哪个树中查找
            if (first instanceof TreeNode)
                return ((TreeNode<K,V>)first).getTreeNode(hash, key);
            do {
                // 遍历链表  如有有相同的就返回
                if (e.hash == hash &&
                    ((k = e.key) == key || (key != null && key.equals(k))))
                    return e;
            } while ((e = e.next) != null);
        }
    }
    return null;
}
```

## 删除元素
```java
// java.util.HashMap#remove(java.lang.Object)
public V remove(Object key) {
    Node<K,V> e;
    return (e = removeNode(hash(key), key, null, false, true)) == null ?
        null : e.value;
}
// java.util.HashMap#removeNode
final Node<K,V> removeNode(int hash, Object key, Object value,
                               boolean matchValue, boolean movable) {
    Node<K,V>[] tab; Node<K,V> p; int n, index;
    if ((tab = table) != null && (n = tab.length) > 0 &&
        (p = tab[index = (n - 1) & hash]) != null) {
        Node<K,V> node = null, e; K k; V v;
        // 如果头节点就是想要的 就让 node = p
        if (p.hash == hash &&
            ((k = p.key) == key || (key != null && key.equals(k))))
            node = p;
        else if ((e = p.next) != null) {
            if (p instanceof TreeNode)
                // 如果是树 就从树里面找
                node = ((TreeNode<K,V>)p).getTreeNode(hash, key);
            else {
                do {
                    // 遍历链表 p永远是e的上一个节点
                    if (e.hash == hash &&
                        ((k = e.key) == key ||
                            (key != null && key.equals(k)))) {
                        // 找到了就结束
                        node = e;
                        break;
                    }
                    p = e;
                } while ((e = e.next) != null);
            }
        }
        // 如果找到了
        if (node != null && (!matchValue || (v = node.value) == value ||
                                (value != null && value.equals(v)))) {
            // 如果树就从树中删除
            if (node instanceof TreeNode)
                ((TreeNode<K,V>)node).removeTreeNode(this, tab, movable);
            else if (node == p)
                // 如果是头节点 就让下一个节点做头节点
                tab[index] = node.next;
            else
                // 从链表中找到的 
                // 前一个节点p直接指向node的下一个节点
                // 这是单链表删除节点的方式
                p.next = node.next;
            // 调整修改次数和size
            ++modCount;
            --size;
            // 回调模板方法 这里一般是linkedhashMap使用
            afterNodeRemoval(node);
            return node;
        }
    }
    return null;
}
```

## 数组扩容
```java
//java.util.HashMap#resize
final Node<K,V>[] resize() {
    // 老数组
    Node<K,V>[] oldTab = table;
    // 老数组长度
    int oldCap = (oldTab == null) ? 0 : oldTab.length;
    // 老threshold
    int oldThr = threshold;
    // 新的数组长度
    int newCap, newThr = 0;
    if (oldCap > 0) {
        // 这里是扩容 不是初始化
        // 最大长度是  1 << 30
        if (oldCap >= MAXIMUM_CAPACITY) {
            threshold = Integer.MAX_VALUE;
            return oldTab;
        }
        // cap 和 threshold 都翻倍
        else if ((newCap = oldCap << 1) < MAXIMUM_CAPACITY &&
                    oldCap >= DEFAULT_INITIAL_CAPACITY)
            newThr = oldThr << 1; // double threshold
    }
    else if (oldThr > 0) // 这是初始化指定了大小
        newCap = oldThr;
    else {               // 这是初始化没指定大小
        newCap = DEFAULT_INITIAL_CAPACITY; // 默认大小是16
        // 16 * 0.75
        newThr = (int)(DEFAULT_LOAD_FACTOR * DEFAULT_INITIAL_CAPACITY);
    }
    if (newThr == 0) {
        // 这是初始化指定了大小的情况 计算threshold
        // 做了一些边界判断
        float ft = (float)newCap * loadFactor;
        newThr = (newCap < MAXIMUM_CAPACITY && ft < (float)MAXIMUM_CAPACITY ?
                    (int)ft : Integer.MAX_VALUE);
    }
    // 记录新的threshold
    threshold = newThr;
    @SuppressWarnings({"rawtypes","unchecked"})
    // 创建新数组
    Node<K,V>[] newTab = (Node<K,V>[])new Node[newCap];
    table = newTab;
    if (oldTab != null) {
        // 如果原数组不为空 那么要吧数据全部都迁移过去
        for (int j = 0; j < oldCap; ++j) {
            Node<K,V> e;
            if ((e = oldTab[j]) != null) {
                // 遍历每个index
                oldTab[j] = null;
                // 如果只有一个头节点 那么直接计算新的位置并查入
                if (e.next == null)
                    newTab[e.hash & (newCap - 1)] = e;
                // 如果是树就走树的拆分
                else if (e instanceof TreeNode)
                    ((TreeNode<K,V>)e).split(this, newTab, j, oldCap);
                else { // preserve order
                    // 按照原有顺序拆分链表
                    // 这里的一个链表一会会被拆分为2个链表
                    //    1.数组的长度是2的n次方 也就是二进制 [0000]1[0000] 这种,此时length-1是 011111 这种
                    //    2.扩容后1向前移动一位 对应的legnth-1也在接近0最高位添加一个1
                    //    3.那么此时index可能变的节点有一个共同的特征，那就是hash对应length-1中新增加1的那个位置是1的节点，index会变大，变大数值就是新增的那个1 也就是原来的长度
                    // 举例说明
                    // 两个节点hash 节点1: 7 => 111  节点2: 15 => 1111
                    // 原长度 8 => 1000  8-1 => 0111
                    // 此时两个节点的index均为7
                    // 扩容后 16 => 10000   16-1 => 01111
                    // 扩容后两个节点的位置 第一个节点：7 第二个节点：15
                    // 可以看到第二个节点在第四位是1 也就是扩容后新增加的1 也就是原数组长度 index的增加也正好就是增加了这个1 

                    // 低链表 就是不变的
                    Node<K,V> loHead = null, loTail = null;
                    // 高链表 就是hash对应新增那位是1的 index会增加oldCap
                    Node<K,V> hiHead = null, hiTail = null;
                    Node<K,V> next;
                    do {
                        // 遍历每一个节点
                        next = e.next;
                        if ((e.hash & oldCap) == 0) {
                            // 新增加那位不是1 放到低链表
                            if (loTail == null)
                                loHead = e;
                            else
                                loTail.next = e;
                            loTail = e;
                        }
                        else {
                            // 新增加那位是1 放到高链表
                            if (hiTail == null)
                                hiHead = e;
                            else
                                hiTail.next = e;
                            hiTail = e;
                        }
                    } while ((e = next) != null);
                    if (loTail != null) {
                        // 将低链表的放到原index
                        loTail.next = null;
                        newTab[j] = loHead;
                    }
                    if (hiTail != null) {
                        // 将高链表的放到原index+oldCap
                        hiTail.next = null;
                        newTab[j + oldCap] = hiHead;
                    }
                }
            }
        }
    }
    return newTab;
}
```