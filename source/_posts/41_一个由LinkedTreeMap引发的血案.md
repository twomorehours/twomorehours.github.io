---
title: 一个由LinkedTreeMap引发的血案
date: 2020-07-10 10:30:39
tags:
categories:
- java
---


## 案发现场
```java
import com.google.gson.Gson;
import com.google.gson.internal.LinkedTreeMap;
import java.util.Map;

public class GsonTest {
    public static void main(String[] args) {
        LinkedTreeMap<String, String> map = new LinkedTreeMap<>();
        Gson gson = new Gson();
        map.put("1", "1");
        Map.Entry<String, String> next = map.entrySet().iterator().next();
        String s = gson.toJson(next);
        System.out.println(s);
    }
}
```
这段代码输出如下结果
```text
Exception in thread "main" java.lang.StackOverflowError
    // 省略一亿行递归
	at com.google.gson.internal.bind.ReflectiveTypeAdapterFactory$Adapter.write(ReflectiveTypeAdapterFactory.java:236)
	at com.google.gson.Gson$FutureTypeAdapter.write(Gson.java:1018)
	at com.google.gson.internal.bind.TypeAdapterRuntimeTypeWrapper.write(TypeAdapterRuntimeTypeWrapper.java:69)
	at com.google.gson.internal.bind.ReflectiveTypeAdapterFactory$1.write(ReflectiveTypeAdapterFactory.java:127)
	at com.google.gson.internal.bind.ReflectiveTypeAdapterFactory$Adapter.write(ReflectiveTypeAdapterFactory.java:245)
	at com.google.gson.Gson$FutureTypeAdapter.write(Gson.java:1018)
	at com.google.gson.internal.bind.TypeAdapterRuntimeTypeWrapper.write(TypeAdapterRuntimeTypeWrapper.java:69)
	at com.google.gson.internal.bind.ReflectiveTypeAdapterFactory$1.write(ReflectiveTypeAdapterFactory.java:127)
	at com.google.gson.internal.bind.ReflectiveTypeAdapterFactory$Adapter.write(ReflectiveTypeAdapterFactory.java:245)
	at com.google.gson.Gson$FutureTypeAdapter.write(Gson.java:1018)
	at com.google.gson.internal.bind.TypeAdapterRuntimeTypeWrapper.write(TypeAdapterRuntimeTypeWrapper.java:69)
	at com.google.gson.internal.bind.ReflectiveTypeAdapterFactory$1.write(ReflectiveTypeAdapterFactory.java:127)
	at com.google.gson.internal.bind.ReflectiveTypeAdapterFactory$Adapter.write(ReflectiveTypeAdapterFactory.java:245)
	at com.google.gson.Gson$FutureTypeAdapter.write(Gson.java:1018)
	at com.google.gson.internal.bind.TypeAdapterRuntimeTypeWrapper.write(TypeAdapterRuntimeTypeWrapper.java:69)
	at com.google.gson.internal.bind.ReflectiveTypeAdapterFactory$1.write(ReflectiveTypeAdapterFactory.java:127)
	at com.google.gson.internal.bind.ReflectiveTypeAdapterFactory$Adapter.write(ReflectiveTypeAdapterFactory.java:245)
	at com.google.gson.Gson$FutureTypeAdapter.write(Gson.java:1018)
	at com.google.gson.internal.bind.TypeAdapterRuntimeTypeWrapper.write(TypeAdapterRuntimeTypeWrapper.java:69)
	at com.google.gson.internal.bind.ReflectiveTypeAdapterFactory$1.write(ReflectiveTypeAdapterFactory.java:127)

Process finished with exit code 1
```
一个很明显异常的`StackOverflowError`，但是要解决这个问题，我们先从重新认识一个的对象开始

## 对象是一棵树
没错，对象就是一棵树，只不过这棵树不是那么规范罢了
```java
static class User {
        String name;
        List<Map<String, String>> cars;
}

//
//                User
//               /    \
//             name    cars
//                    /  |  \
//                car1  car2  car3 
//                /  \
//             属性1  属性2   
```

## toJson的本质
toJson的本质实际上就是`树的深度优先遍历`
实现步骤
- 判断传入对象类型
- 不可分割类型(String int BigDecimal等)
    - 直接输出
- List类型
    - 遍历，继续递归
- Map类型
    - 遍历 ，KV全都递归
- POJO类型
    - 反射，字段名+值递归 （Gson就是这么做的,Gson不走Getter）

## 自己撸一个Zson
```java
public class Zson {


    public String toJson(Object obj) {
        StringBuilder builder = new StringBuilder();
        toJson(obj, builder);
        return builder.toString();
    }

    private void toJson(Object obj, StringBuilder builder) {
        // 这里不可分割类型 图省事只写了一个String
        if (obj instanceof String) {
            builder.append("\"").append(obj).append("\"");
        } else if (obj instanceof List) {
            // 数组类型
            builder.append("[");
            List list = (List) obj;
            for (int i = 0; i < list.size(); i++) {
                toJson(list.get(i), builder);
                if (i != list.size() - 1) {
                    builder.append(",");
                }
            }
            builder.append("]");
        } else if (obj instanceof Map) {
            // Map类型 KV递归
            builder.append("{");
            Map<Object, Object> map = (Map) obj;
            int size = map.size();
            int count = 0;
            for (Map.Entry<Object, Object> entry : map.entrySet()) {
                toJson(entry.getKey(), builder);
                builder.append(":");
                toJson(entry.getValue(), builder);
                if (count++ != size - 1) {
                    builder.append(",");
                }
            }
            builder.append("}");
        } else {
            // pojo 字段名+值递归
            builder.append("{");
            Field[] declaredFields = obj.getClass().getDeclaredFields();
            for (int i = 0; i < declaredFields.length; i++) {
                Field declaredField = declaredFields[i];
                declaredField.setAccessible(true);
                try {
                    builder.append("\"").append(declaredField.getName()).append("\"").append(":");
                    Object o = declaredField.get(obj);
                    toJson(o, builder);
                } catch (IllegalAccessException e) {
                    e.printStackTrace();
                }
                if (i != declaredFields.length - 1) {
                    builder.append(",");
                }

            }
            builder.append("}");
        }
    }

    static class User {
        String name;
        List<Map<String, String>> cars;

        public User() {
        }
    }

    public static void main(String[] args) {
        Zson zson = new Zson();

        User user = new User();

        user.name = "penglei";

        ArrayList<Map<String, String>> cars = new ArrayList<>();
        HashMap<String, String> car1 = new HashMap<>();
        car1.put("brand", "Rolls-Royce");
        car1.put("price", "8000000");
        HashMap<String, String> car2 = new HashMap<>();
        car2.put("brand", "Bentley");
        car2.put("price", "7000000");
        cars.add(car1);
        cars.add(car2);
        user.cars = cars;
        System.out.println(zson.toJson(user));
    }
}
```

## Gson的实现
- 对应我们的`toJson(Object obj, StringBuilder builder)`
    ```java
    //com.google.gson.Gson.FutureTypeAdapter#write
    public void write(JsonWriter out, T value) throws IOException {
      if (delegate == null) {
        throw new IllegalStateException();
      }
      delegate.write(out, value);
    }
    ```
- 对类型的判断Gson使用了策略模式，我们来看下Gson是怎么处理Pojo的
    ```java
    //com.google.gson.internal.bind.ReflectiveTypeAdapterFactory.Adapter#write
    // 看这名字就是反射
    public void write(JsonWriter out, T value) throws IOException {
      if (value == null) {
        out.nullValue();
        return;
      }

      // 写个 {
      out.beginObject();
      try {
          //这个boundFields 实际上就是Fields new对象的时候指定的
        for (BoundField boundField : boundFields.values()) {
          if (boundField.writeField(value)) {
            // 写字段名
            out.name(boundField.name);
            // 写字段值
            boundField.write(out, value);
          }
        }
      } catch (IllegalAccessException e) {
        throw new AssertionError(e);
      }
      // 写个 }
      out.endObject();
    }
    // 写字段值
    //com.google.gson.internal.bind.ReflectiveTypeAdapterFactory.BoundField#write
    void write(JsonWriter writer, Object value)
          throws IOException, IllegalAccessException {
        Object fieldValue = field.get(value);
        TypeAdapter t = jsonAdapterPresent ? typeAdapter
            : new TypeAdapterRuntimeTypeWrapper(context, typeAdapter, fieldType.getType());
        // 这里就回到了最开始的write(JsonWriter out, T value)
        // 所以这两步就是问题的关键
        t.write(writer, fieldValue);
      }
    ```

其实这个步骤和我们实现的没有区别，只是Gson这里多了一步而已

## LinkedTreeMap是个什么鬼
TreeMap是红黑树实现，LinkedTreeMap就是在每个节点上增加了两个指针，形成了一个双向链表，来维护插入的顺序，这个机制也是实现`LRU`的快捷方式
```java
//com.google.gson.internal.LinkedTreeMap
static final class Node<K, V> implements Entry<K, V> {
    Node<K, V> parent; // 父节点
    Node<K, V> left; // 左孩子
    Node<K, V> right; // 右孩子
    Node<K, V> next; // 前面插入的节点
    Node<K, V> prev; // 后面插入的节点
    final K key; // key
    V value; // val
    int height; // 层高
}
```

## LinkedTreeMap的插入实现
```java
//com.google.gson.internal.LinkedTreeMap#put
 public V put(K key, V value) {
    if (key == null) {
      throw new NullPointerException("key == null");
    }
    // 没有则插入一个节点
    Node<K, V> created = find(key, true);
    V result = created.value;
    created.value = value;
    return result;
}
//com.google.gson.internal.LinkedTreeMap#find
Node<K, V> find(K key, boolean create) {
    // 上面是查找流程
    // 省略
    // The key doesn't exist in this tree.
    if (!create) {
      return null;
    }
    // 插入
    // 这里有个header 这个header实际上是最后一个节点 
    // 这个header的next指向第一个节点
    // 构造时header的prev和next都指向自己
    // 这个header实际上迭代器用的 从val = header.next开始 一直迭代到val != header
    // 每插入一个新节点 就放到header的前面 如下图
    // 节点1 先于 节点2 插入
    // 双向循环链表
    //                      ---------------------------
    //                     |                          |     
    //                     |                          ↓
    //                    节点1  <—>  节点2   <->    header
    //                     ↑                          |
    //                     |---------------------------  
    //
    //
    /** 
     // 创建header节点 
      Node() {
        key = null;
        next = prev = this;
      }
    */
    Node<K, V> header = this.header;
    Node<K, V> created;
    if (nearest == null) {
      // Check that the value is comparable if we didn't do any comparisons.
      if (comparator == NATURAL_ORDER && !(key instanceof Comparable)) {
        throw new ClassCastException(key.getClass().getName() + " is not Comparable");
      }
      // 这里就是关键
      // 根据构造函数得出
      // 此时插入的node的prev和next都是header
      // 而header的prev和next也都是这个节点
      /*  
      // 创建普通节点
      Node(Node<K, V> parent, K key, Node<K, V> next, Node<K, V> prev) {
        this.parent = parent;
        this.key = key;
        this.height = 1;
        this.next = next; 
        this.prev = prev; 
        prev.next = this;
        next.prev = this;
      }
      */
      created = new Node<K, V>(nearest, key, header, header.prev);
      root = created;
    } else {
      
      //...
    }
    size++;
    modCount++;

    return created;
}
```

## 真相
我们在插入一个节点后是这样
```text
//                      ----------------
//                     |               |     
//                     |               ↓
//                    节点1    <->    header
//                     ↑                |
//                     |-----------------  
```

作死步骤
- 节点1                     FutureTypeAdapter#write
- 节点1.next=header         FutureTypeAdapter#write
- header                    FutureTypeAdapter#write
- header.prev=节点1         FutureTypeAdapter#write
- 节点1                     FutureTypeAdapter#write     递归

## 总结
无情哈拉少，奥里给！！！