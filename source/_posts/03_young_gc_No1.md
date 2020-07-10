---
title: young gc No.1
date: 2019-09-16 15:29:26
categories: 
- JVM

---



## JVM常用启动参数

| 参数名称                   |                             含义                             |
| -------------------------- | :----------------------------------------------------------: |
| -Xms                       |                          堆最小内存                          |
| -Xmx                       |                          堆最大内存                          |
| -XX:NewSize                |                          新生代内存                          |
| -XX:MaxNewSize             |                        新生代最大内存                        |
| -XX:SurvivorRatio          | 新生代内存比例默认为8:1:1  如果设置为5:1:1则值为5,eden占:5/7 |
| -XX:PretenureSizeThreshold |                  大对象直接进入老年代的阀值                  |
| -XX:MaxTenuringThreshold   | 新生代对象进入老年代的年龄阀值,默认为15(对象头:4字节最大1111) |
| -XX:TargetSurvivorRatio    |     动态年龄判断条件,新生代对象占s0区域的比率,默认为50%      |
| -XX:+UseParNewGC           |    新生代使用parNew收集器(多线程并发标记, stop the world)    |
| -XX:+UseConcMarkSweepGC    |                     老年代使用CMS收集器                      |
| -XX:+PrintGCDetails        |                        打印gc日志详情                        |
| -XX:+PrintGCTimeStamps     |                         打印gc时间戳                         |
| -Xloggc:gc.log             |                       gc日志对应的文件                       |



## 堆内存对象分配流程

1. 对象优先分配新生代eden区(大对象直接进入老年代)
2. 当eden区域没有可用内存空间分配时触发young gc
3. young gc触发时进行分配担当判断(保证young gc成功)
   - 判断老年代可用连续空间是否大于新生代,大于则分配担当成功
   - 小于,则判断老年代可用连续空间是否大于历次新生代进入老年代的对象平均大小,大于则分配担当成功
   - 小于则先执行full gc保证老年代空间够用
4. 执行young gc时通过gc root可达性算法(gc root对象有局部变量和静态变量或常量)标记新生代中存活的对象
5. 第一次young gc时将eden中存活的对象通过复制算法复制到新生代 survival0,第二次即将eden和survival0中存活对象复制到survival1(每次保证s0或s1为空用来放young gc后存活对象)



## 新生代对象何时进入老年代

1. 新生代young gc时存活的对象大于新生代s0堆内存大小

2. 新生代young gc后存在某个对象的年龄大于等于了进入老年代对象的阀值(默认15)

3. 新生代young gc后满足动态年龄判断条件,比如新生代中年龄代0,1,2占比49%  3:2% 4:49%,此时年龄0+1+2+3对象占比为51%,则大于等于年龄3的对象进入老年代即年龄3和4

   ```java
   jdk源码地址:http://hg.openjdk.java.net/jdk8/jdk8/hotspot/file/87ee5ee27509/src/share/vm/gc_implementation/shared/ageTable.cpp#l81
   ```



## young gc存活对象大于s0例子

```java
/**
 * @author <a href="mailto:twomorehours@163.com">twomorehours</a>
 * Date: 2020-04-23 15:23
 * version: 1.0
 * Description:young gc后存活的对象大于s0堆大小导致对象进入老年代
 **/
public class YoungGcIntoOldByGreaterS0Demo {

    /**
     * jvm参数:
     * -XX:NewSize=10M -XX:MaxNewSize=10M -Xms20M -Xmx20M -XX:SurvivorRatio=8 -XX:PretenureSizeThreshold=10M -XX:+UseParNewGC -XX:+UseConcMarkSweepGC -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -Xloggc:gc.log
     * <p>
     * 参数分析:
     * 1.新生代 10M eden:8M s0:1M s1:1M
     * 2.老年代 10M
     *
     * @param args
     */
    public static void main(String[] args) {
        byte[] array01 = new byte[2 * 1024 * 1024];
        array01 = new byte[128 * 1024];
        array01 = new byte[2 * 1024 * 1024];
        array01 = new byte[2 * 1024 * 1024];

        byte[] array02 = new byte[2 * 1024 * 1024];
    }
}
```

通过:java jvm参数  -jar demo.jar  启动后gc.log信息

```java
Java HotSpot(TM) 64-Bit Server VM (25.211-b12) for bsd-amd64 JRE (1.8.0_211-b12), built on Apr  1 2019 20:53:18 by "java_re" with gcc 4.2.1 (Based on Apple Inc. build 5658) (LLVM build 2336.11.00)
Memory: 4k page, physical 33554432k(2646028k free)

/proc/meminfo:

CommandLine flags: -XX:InitialHeapSize=20971520 -XX:MaxHeapSize=20971520 -XX:MaxNewSize=10485760 -XX:NewSize=10485760 -XX:OldPLABSize=16 -XX:PretenureSizeThreshold=10485760 -XX:+PrintGC -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -XX:SurvivorRatio=8 -XX:+UseCompressedClassPointers -XX:+UseCompressedOops -XX:+UseConcMarkSweepGC -XX:+UseParNewGC 
0.080: [GC (Allocation Failure) 0.080: [ParNew: 6943K->333K(9216K), 0.0014860 secs] 6943K->2383K(19456K), 0.0015622 secs] [Times: user=0.01 sys=0.00, real=0.01 secs] 
Heap
 par new generation   total 9216K, used 2463K [0x00000007bec00000, 0x00000007bf600000, 0x00000007bf600000)
  eden space 8192K,  26% used [0x00000007bec00000, 0x00000007bee14930, 0x00000007bf400000)
  from space 1024K,  32% used [0x00000007bf500000, 0x00000007bf553518, 0x00000007bf600000)
  to   space 1024K,   0% used [0x00000007bf400000, 0x00000007bf400000, 0x00000007bf500000)
 concurrent mark-sweep generation total 10240K, used 2050K [0x00000007bf600000, 0x00000007c0000000, 0x00000007c0000000)
 Metaspace       used 2728K, capacity 4486K, committed 4864K, reserved 1056768K
  class space    used 293K, capacity 386K, committed 512K, reserved 1048576K

-- 分析:新生代 8M 1M 1M 老年代:10M
0.ParNew: 6943K->333K(9216K), 0.0014860 secs,新生代堆总大小9M,gc回收对象从6.9M-->333k,333k未知对象在from区存活,占survival from:32%,耗时1.4ms                                                           
1.当分配array02:2M对象时,此时eden中对象大小为6943K无法分配2M对象导致Allocation Failure(分配失败)触发young gc,young gc进行分配担当判断此时老年代空间大于新生代内存空间不需要触发full gc
                                                            
2.6943K->2383K(19456K), 0.0015622 secs,堆总大小19M,回收前:6.9M 回收后:2M+333k                                                             
2.young gc存活的对象为array01引用2M对象,回收:2M+2M+128K对象,通过复制算法加入到s0时发现空间不够,2M对象进入老年代,剩下未知对象333k,s0可以放下
                                                            
3.最后eden中分配2M对象,此时对的占用情况为
eden:2M 占比26%
from:333K 占比32%
to:0 占用0%
CMS即old区域:2M                                                                                                                        
```

