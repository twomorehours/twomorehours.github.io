---
title: young gc No.2
date: 2020-04-27 14:12:01
tags:
categories:
- JVM
---

## [上节回顾](https://twomorehours.github.io/2020/04/23/03_young_gc_No1/)

1. 上一章我们学习jvm常用参数,对象的分配流程,新生代对象进入老年代的时机三部分内容
2. 案例分析学习了young gc存活的对象大于s0进入老年代,这一章节我们学习另外两种情况



## 新生代对象年龄大于阀值(MaxTenuringThreshold)

```java
/**
 * @author <a href="mailto:twomorehours@163.com">twomorehours</a>
 * Date: 2020-04-27 14:22
 * version: 1.0
 * Description:young gc存活对象年龄大于阀值MaxTenuringThreshold
 **/
public class YoungGcIntoOldByAgeGreaterThresholdTest {

    /**
     * 启动参数:-XX:NewSize=10M -XX:MaxNewSize=10M -Xms20M -Xmx20M -XX:SurvivorRatio=8 -XX:PretenureSizeThreshold=10M -XX:MaxTenuringThreshold=2 -XX:+UseParNewGC -XX:+UseConcMarkSweepGC -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -Xloggc:gc.log
     * <p>
     * 参数分析:新生代10M 比率8:1:1 eden:8M s0:1M s1:1M 老年代:10M 新生代存活对象年龄大于2后进入老年代
     *
     * @param args
     */
    public static void main(String[] args) {
        byte[] array01 = new byte[64 * 1024];

        // 第一次young gc数据
        byte[] array02 = new byte[2 * 1024 * 1024];
        array02 = new byte[2 * 1024 * 1024];
        array02 = new byte[2 * 1024 * 1024];
        array02 = null;

        // 触发第一次young gc:此时eden:6M+64K对象,当分配2M对象触发young gc
        array02 = new byte[2 * 1024 * 1024];
        array02 = null; // 第一次执行完之后 eden:存活2M对象  s0 存活405K:64K(年龄1)+341k未知对象


        //第二次 young gc数据
        array02 = new byte[2 * 1024 * 1024];
        array02 = new byte[2 * 1024 * 1024];
        array02 = null;

        // 触发第二次young gc,此时新生代eden >6M,在分配2M对象时失败
        array02 = new byte[2 * 1024 * 1024];
        array02 = null; // 第二次执行完之后 eden:存活2M对象 s1:存活446k对象64K(年龄2)+384k未知对象

        // 第三次 young gc数据
        array02 = new byte[2 * 1024 * 1024];
        array02 = new byte[2 * 1024 * 1024];
        array02 = null;

        // 触发第三次young gc
        array02 = new byte[2 * 1024 * 1024];
        array02 = null; // 第三次young gc后 eden:2M对象 s0:0 s1:0 存活的对象373k(年龄3) 此时大于>阀值:2进入老年代
    }
}
```

通过java 参数 -jar demo.jar启动后gc.log如下

```java
Java HotSpot(TM) 64-Bit Server VM (25.211-b12) for bsd-amd64 JRE (1.8.0_211-b12), built on Apr  1 2019 20:53:18 by "java_re" with gcc 4.2.1 (Based on Apple Inc. build 5658) (LLVM build 2336.11.00)
Memory: 4k page, physical 33554432k(811900k free)

/proc/meminfo:

CommandLine flags: -XX:InitialHeapSize=20971520 -XX:InitialTenuringThreshold=2 -XX:MaxHeapSize=20971520 -XX:MaxNewSize=10485760 -XX:MaxTenuringThreshold=2 -XX:NewSize=10485760 -XX:OldPLABSize=16 -XX:PretenureSizeThreshold=10485760 -XX:+PrintGC -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -XX:SurvivorRatio=8 -XX:+UseCompressedClassPointers -XX:+UseCompressedOops -XX:+UseConcMarkSweepGC -XX:+UseParNewGC 
0.081: [GC (Allocation Failure) 0.081: [ParNew: 6879K->405K(9216K), 0.0005694 secs] 6879K->405K(19456K), 0.0006479 secs] [Times: user=0.00 sys=0.01, real=0.00 secs] 
0.082: [GC (Allocation Failure) 0.082: [ParNew: 6709K->446K(9216K), 0.0004758 secs] 6709K->446K(19456K), 0.0005024 secs] [Times: user=0.01 sys=0.00, real=0.00 secs] 
0.083: [GC (Allocation Failure) 0.083: [ParNew: 6732K->0K(9216K), 0.0021904 secs] 6732K->373K(19456K), 0.0022311 secs] [Times: user=0.00 sys=0.00, real=0.00 secs] 
Heap
 par new generation   total 9216K, used 2212K [0x00000007bec00000, 0x00000007bf600000, 0x00000007bf600000)
  eden space 8192K,  27% used [0x00000007bec00000, 0x00000007bee290e0, 0x00000007bf400000)
  from space 1024K,   0% used [0x00000007bf500000, 0x00000007bf500000, 0x00000007bf600000)
  to   space 1024K,   0% used [0x00000007bf400000, 0x00000007bf400000, 0x00000007bf500000)
 concurrent mark-sweep generation total 10240K, used 373K [0x00000007bf600000, 0x00000007c0000000, 0x00000007c0000000)
 Metaspace       used 2729K, capacity 4486K, committed 4864K, reserved 1056768K
  class space    used 293K, capacity 386K, committed 512K, reserved 1048576K

ParNew: 6879K->405K(9216K), 0.0005694 secs和6879K->405K(19456K), 0.0006479 secs
-- 第一次young gc:新生代堆大小9M,eden使用6M+64K+未知对象,分配2M对象触发young gc,存活对象405k,包括64K(array01)和未知对象进入新生代 在s0中
                                                           
ParNew: 6709K->446K(9216K), 0.0004758 secs] 6709K->446K(19456K), 0.0005024 secs
-- 第二次young gc:新生代堆大小9M,eden使用3*2M数组,s0:405K,分配2M对象到eden时分配失败触发young gc,存活对象446K,其中64K(array01)和382K(未知对象) 在s1中

ParNew: 6732K->0K(9216K), 0.0021904 secs] 6732K->373K(19456K), 0.0022311 secs
-- 第三次young gc:新生代堆大小9M,eden使用3*2M数组,s1:446K,分配2M对象到eden时分配失败触发young gc,存活对象为373K,此时这部分对象年龄为3>(-XX:MaxTenuringThreshold=2),导致对象晋级到老年代,最后新生代分配2M对象,此时堆如下
eden space 8192K,  27%:eden使用2M数组对象
from和to 0K
concurrent mark-sweep generation total 10240K, used 373K :老年代使用373K,64K(array01)+209K未知对象                               
```





## 新生代对象存活占比大于s0一半(-XX:TargetSurvivorRatio)

```java
/**
 * @author <a href="mailto:twomorehours@163.com">twomorehours</a>
 * Date: 2020-04-27 15:14
 * version: 1.0
 * Description:新生代对象进入老年代,动态年龄判断进入
 **/
public class YoungGcIntoOldDynamicAgeTest {

    /**
     * 启动参数:-XX:NewSize=10M -XX:MaxNewSize=10M -Xms20M -Xmx20M -XX:SurvivorRatio=8 -XX:PretenureSizeThreshold=10M -XX:MaxTenuringThreshold=15 -XX:+UseParNewGC -XX:+UseConcMarkSweepGC -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -Xloggc:gc.log
     * <p>
     * 参数分析:
     * 1.新生代 10M eden:8M s0:1M s1:1M
     * 2.老年代 10M
     * 3.大对象 10M
     * 4.年龄阀值 15
     * 5.-XX:TargetSurvivorRatio 使用默认50%
     *
     * @param args
     */
    public static void main(String[] args) {
        // 存活对象
        byte[] array01 = new byte[256 * 1024];

        byte[] array02 = new byte[2 * 1024 * 1024];
        array02 = new byte[2 * 1024 * 1024];
        array02 = new byte[2 * 1024 * 1024];
        array02 = null;


        // 触发第一次young gc 结果:eden:2M from:576K包括256K(array01)
        byte[] array03 = new byte[2 * 1024 * 1024];

        array03 = new byte[2 * 1024 * 1024];
        array03 = new byte[2 * 1024 * 1024];
        array03 = new byte[128 * 1024];
        array03 = null;

        // 触发第二次minor gc 结果:存活对象565K占比超过了s1的一半50%(1024*0.5=512)进入老年代
        byte[] array04 = new byte[2 * 1024 * 1024];
    }
}
```

通过java 参数 -jar demo.jar启动后gc.log如下

```java
Java HotSpot(TM) 64-Bit Server VM (25.211-b12) for bsd-amd64 JRE (1.8.0_211-b12), built on Apr  1 2019 20:53:18 by "java_re" with gcc 4.2.1 (Based on Apple Inc. build 5658) (LLVM build 2336.11.00)
Memory: 4k page, physical 33554432k(700020k free)

/proc/meminfo:

CommandLine flags: -XX:InitialHeapSize=20971520 -XX:MaxHeapSize=20971520 -XX:MaxNewSize=10485760 -XX:MaxTenuringThreshold=15 -XX:NewSize=10485760 -XX:OldPLABSize=16 -XX:PretenureSizeThreshold=10485760 -XX:+PrintGC -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -XX:SurvivorRatio=8 -XX:+UseCompressedClassPointers -XX:+UseCompressedOops -XX:+UseConcMarkSweepGC -XX:+UseParNewGC 
0.074: [GC (Allocation Failure) 0.074: [ParNew: 7071K->576K(9216K), 0.0005720 secs] 7071K->576K(19456K), 0.0006390 secs] [Times: user=0.00 sys=0.00, real=0.00 secs] 
0.075: [GC (Allocation Failure) 0.075: [ParNew: 6880K->0K(9216K), 0.0018054 secs] 6880K->565K(19456K), 0.0018326 secs] [Times: user=0.00 sys=0.01, real=0.00 secs] 
Heap
 par new generation   total 9216K, used 2212K [0x00000007bec00000, 0x00000007bf600000, 0x00000007bf600000)
  eden space 8192K,  27% used [0x00000007bec00000, 0x00000007bee290e0, 0x00000007bf400000)
  from space 1024K,   0% used [0x00000007bf400000, 0x00000007bf400000, 0x00000007bf500000)
  to   space 1024K,   0% used [0x00000007bf500000, 0x00000007bf500000, 0x00000007bf600000)
 concurrent mark-sweep generation total 10240K, used 565K [0x00000007bf600000, 0x00000007c0000000, 0x00000007c0000000)
 Metaspace       used 2729K, capacity 4486K, committed 4864K, reserved 1056768K
  class space    used 293K, capacity 386K, committed 512K, reserved 1048576K

ParNew: 7071K->576K(9216K), 0.0005720 secs] 7071K->576K(19456K), 0.0006390 secs
-- 第一次young gc,eden此时6M+256K对象,分配2M对象失败触发young gc,存活对象576K进入s0区域,256K(array01)和220K未知对象(第一次不做动态判断)

ParNew: 6880K->0K(9216K), 0.0018054 secs] 6880K->565K(19456K), 0.0018326 secs
-- 第二次young gc,eden:6M+128K 分配2M对象失败触发young gc,此时s0:576K 本次young gc存活对象为565K,这部分对象年龄都为2大于了s0的一半50%(1024*0.5=512)直接进入老年代

堆中结果:
eden space 8192K,  27% :最后分配array04:2M对象
from和to 0K
concurrent mark-sweep generation total 10240K, used 565K :老年代565K                               
```

