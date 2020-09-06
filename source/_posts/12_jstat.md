---
title: jstat
date: 2019-11-03 19:30:39
categories: 
- Java
tags:
- GC
---



## 本章内容

1. jstat命令
2. jstat参数含义
3. 案例分析
4. 分析参数



## jstat命令

```java
jps -l:查看启动类对应的pid
jstat -gc -h3 pid 1000 10:输出指定pid的gc日志每隔10秒输出一次,每三次换行10次后终止
```



## jstat参数含义

| 参数 |            含义            |
| :--: | :------------------------: |
| S0C  |     新生代s0堆内存大小     |
| S1C  |     新生代s1堆内存大小     |
| S0U  |  新生代s0堆内存已使用大小  |
| S1U  |  新生代s1堆内存已使用大小  |
|  EC  |    新生代eden堆内存大小    |
|  EU  | 新生代eden堆内存已使用大小 |
|  OC  |      老年代堆内存大小      |
|  OU  |   老年代堆内存已使用大小   |
|  MC  |      metaspace总大小       |
|  MU  |    metaspace已使用大小     |
| CCSC |       压缩类空间大小       |
| CCSU |     压缩类空间使用大小     |
| YGC  |      young gc总的次数      |
| YGCT |    young gc总共执行时间    |
| FGC  |      full gc总的次数       |
| FGCT |    full gc总共执行时间     |
| GCT  |        整个gc的耗时        |



## 案例分析

```java
/**
 * @author <a href="mailto:twomorehours@163.com">twomorehours</a>
 * Date: 2020-05-17 10:48
 * version: 1.0
 * Description:
 **/
public class YoungGcJstatLogDemo {

    /**
     * 启动参数:
     * -XX:NewSize=100M -XX:MaxNewSize=100M -Xms200M -Xmx200M -XX:SurvivorRatio=8 -XX:PretenureSizeThreshold=10M -XX:+UseParNewGC -XX:+UseConcMarkSweepGC -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -Xloggc:gc.log
     * <p>
     * 新生代100M 老年代:100M 新生代8:1:1 eden:80M s0和s1:10M
     * 大对象:10M gc收集器:ParNew+CMS
     *
     * @param args
     */
    public static void main(String[] args) {
        try {
            // jps -l 查看pid和jstat -gc -h3 pid 1000 查看jstat
            Thread.sleep(3000);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }

        while (true) {
            loadData();
        }
    }

    private static void loadData() {
        byte[] data = null;
        // 每秒5M对象
        for (int i = 0; i < 50; i++) {
            data = new byte[100 * 1000];
        }
        data = null;

        // 固定每秒5M对象
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }
}
```



## 分析参数

![image-20200518110326885](https://note.youdao.com/yws/public/resource/88d580afe4046aad487d0feea3a40407/xmlnote/49E3B285D44243EEBF41499A4038A1A8/9375)

1. 新生代对象增长速度:观察EU和代码可知每秒增长5M对象
2. 多久后触发一次young gc:eden的大小为80M,大概16s左右触发一次
3. 每次young gc的耗时:两次young gc YGCT:为0.003s/2 即1.5ms左右
4. young gc后存活对象:第一次s1:916K  第二次:s0 1110K
5. young gc后是否有新生代对象进入老年代:通过观察两次young gc和分析代码可知无对象进入老年代



## 下章内容

1. full gc的jstat日志分析
2. 通过jstat分析出来的参数来优化jvm参数