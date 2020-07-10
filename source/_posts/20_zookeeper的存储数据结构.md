---
title: zookeeper的存储数据结构
date: 2019-12-21 09:55:39
tags:
categories:
- java
- zookeeper
---

## zookeeper的逻辑数据结构
zookeeper的`逻辑`数据结构是`树型结构`,如下图所示
```text
|-- a
|   |-- a1
|   `-- a2
`-- b
    |-- b1
    `-- b2
```
这样的`逻辑`数据结构让人能更加容易理解和使用zk
但是实际存储真的需要使用树形结构吗？

## 树的问题
`树型结构`有两个显著特点
- 有序(支持范围查找)
- CRUD均为`O(logN)`

但是zookeeper需要这些吗？
- zk没有有序性的要求，也没有范围查找的需求

那么zk如果放弃了这些，能不能换取更高的性能呢？

## zk的存储实践
先上结论：zk的存储结构实际上是`hash表`
```text
|-- a(data1)
|   |-- a1(data2)
|   `-- a2(data3)
`-- b(data4)
    |-- b1(data5)
    `-- b2(data6)

{
    "/":{children:["/a","/b"]},
    "/a":{"data":data1,children:["/a1","/a2"]},
    "/a/a1":{"data":data2,"children":[]},
    "/a/a2":{"data":data3,"children":[]},
    "/b":{"data":data4,children:["/b1","/b2"]},
    "/b/b1":{"data":data5,"children":[]},
    "/b/b2":{"data":data6,"children":[]},
}
```
我们来看下CRUD的时间复杂度
- create 直接put O(1)
- get 直接get O(1)
- ls 还是直接get O(1)
- delete 直接remove O(1) ，如果递归删除的话就取决于子节点的多少了

## 存储结构实例代码
```java
class DataTree{
    HashMap<String,DataNode> map;
}
class DataNode{
    byte[] data;
    String path;
    Set<String> children;
}
```

## DataTree的序列化
zk的内存数据结构可以序列化到磁盘上，序列化的方式为`前序遍历`，因为这样在反序列化时，父节点可以先被加载到内存中
```java
void serializeNode(OutputArchive oa, StringBuilder path) throws IOException {
    String pathString = path.toString();
    DataNode node = getNode(pathString);
    if (node == null) {
        return;
    }
    String[] children = null;
    DataNode nodeCopy;
    synchronized (node) {
        StatPersisted statCopy = new StatPersisted();
        copyStatPersisted(node.stat, statCopy);
        //we do not need to make a copy of node.data because the contents
        //are never changed
        nodeCopy = new DataNode(node.data, node.acl, statCopy);
        Set<String> childs = node.getChildren();
        children = childs.toArray(new String[childs.size()]);
    }
    //先把当前节点序列化
    serializeNodeData(oa, pathString, nodeCopy);
    path.append('/');
    int off = path.length();
    for (String child : children) {
        // since this is single buffer being resused
        // we need
        // to truncate the previous bytes of string.
        path.delete(off, Integer.MAX_VALUE);
        path.append(child);
        // 再递归序列化子节点
        serializeNode(oa, path);
    }
}


public void deserialize(InputArchive ia, String tag) throws IOException {
    aclCache.deserialize(ia);
    nodes.clear();
    pTrie.clear();
    nodeDataSize.set(0);
    String path = ia.readString("path");
    while (!"/".equals(path)) {// 反序列化未结束
        DataNode node = new DataNode();
        // 反序列化出自己
        ia.readRecord(node, "node");
        // 把自己放进去
        nodes.put(path, node);
        synchronized (node) {
            aclCache.addUsage(node.acl);
        }
        int lastSlash = path.lastIndexOf('/');
        if (lastSlash == -1) {
            root = node;
        } else {
            // 取出父节点path
            String parentPath = path.substring(0, lastSlash);
            //取出已经反序列化的父节点
            DataNode parent = nodes.get(parentPath);
            if (parent == null) {
                throw new IOException("Invalid Datatree, unable to find "
                                        + "parent "
                                        + parentPath
                                        + " of path "
                                        + path);
            }
            // 把自己放到父节点的children中
            parent.addChild(path.substring(lastSlash + 1));
            // ....
        }
        //取出下一个path
        path = ia.readString("path");
    }
    //...
}
```