---
title: idea开启spring-boot-devtools
date: 2019-11-23 10:30:39
tags:
categories:
- SpringBoot
---


## 什么是spring-boot-devtools
就是你在开发环境改完代码要部署，改一行代码就手动重启一次，不仅繁琐，而且启动很慢，`spring-boot-devtools`提供了代码的增量部署，只要修改代码，`spring-boot-devtools`就会重载classpath下的class文件（不会重载依赖的jar中的代码，具体是靠多个类加载器实现的），无需手动重启，方便且启动速度非常快。

## 如何配置
- 引入`spring-boot-devtools`依赖
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-devtools</artifactId>
    <scope>runtime</scope>
    <optional>true</optional>
</dependency>
```

- 开始idea的自动编译功能(这样才能把你修改的代码编译成class,才会被工具检测到)
```text
Settings/Preferences -> Build、Execution、Development -> Compiler
✅ Build project automatically
```

- 开启idea运行时自动编译许可
```text
ctrl/command + shift + alt/option + / -> 1.Registry
compiler.automake.allow.when.app.running ✅
```

- 重启idea

