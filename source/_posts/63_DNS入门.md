---
title: DNS入门
date: 2020-07-23 21:30:39
categories:
- 运维知识
---

## 什么是DNS
DNS全称`Domain Name System`，作用是保存`域名`到`IP地址`的映射关系，当我们需要访问网络时，首先要将我们知道的域名转换成IP才能访问，这个转换的过程就要依靠DNS实现

## DNS的分类
- LocalDNS 
    - 这种DNS是直接与客户端交互的DNS，只保存根DNS服务器的地址，我们所熟知的DNS服务器，如`114`，就是LocalDNS
- NS
  - 这种DNS保存真正的映射关系


## DNS的层次结构
```text
            |     根DNS                         ROOTDNS
            |                                /   |   \
LocalDNS    |    顶级域名DNS                 com  ...   cn      
            |                            /  |   \
            |    (二级域名)权威域名DNS baidu.com   ...   jd.com            


```

## DNS的解析过程
以`www.baidu.com`为例
- 客户端向LocalDNS发起解析请求
- LocalDNS查看本地缓存，有就直接返回
- localDNS拉取所有根域名服务器地址
- localDNS选择一台根服务器询问com
- 根服务器返回com顶级域名服务器地址
- localDNS选择一台com顶级域名服务器询问baidu.com地址
- 顶级域名服务器返回baidu.com权威服务器列表
- localDNS选择一台baidu.com的权威域名服务器询问www.baidu.com的地址
- 权威域名服务器返回地址给localDNS
- localdns加入缓存并返回给客户端

客户端查询LocalDNS叫做递归查询，LocalDNS查询NS叫做迭代查询

## 实战DNS解析过程
```text
➜  ~ dig yuhao.pro +trace

; <<>> DiG 9.11.4-P2-RedHat-9.11.4-16.P2.el8 <<>> yuhao.pro +trace
;; global options: +cmd
.			600	IN	NS	m.root-servers.net.
.			600	IN	NS	e.root-servers.net.
.			600	IN	NS	b.root-servers.net.
.			600	IN	NS	i.root-servers.net.
.			600	IN	NS	g.root-servers.net.
.			600	IN	NS	j.root-servers.net.
.			600	IN	NS	h.root-servers.net.
.			600	IN	NS	c.root-servers.net.
.			600	IN	NS	k.root-servers.net.
.			600	IN	NS	l.root-servers.net.
.			600	IN	NS	a.root-servers.net.
.			600	IN	NS	d.root-servers.net.
.			600	IN	NS	f.root-servers.net.
拉取所有根域名服务器
;; Received 239 bytes from 192.168.0.2#53(192.168.0.2) in 1 ms 

pro.			172800	IN	NS	b0.pro.afilias-nst.org.
pro.			172800	IN	NS	a0.pro.afilias-nst.info.
pro.			172800	IN	NS	a2.pro.afilias-nst.info.
pro.			172800	IN	NS	b2.pro.afilias-nst.org.
pro.			172800	IN	NS	c0.pro.afilias-nst.info.
pro.			172800	IN	NS	d0.pro.afilias-nst.org.
pro.			86400	IN	DS	47221 7 2 5A10389E282CB03F1083C1662B218B97CFE61024B991C7C5D8BB5685 AD6487CA
pro.			86400	IN	DS	47221 7 1 00CBFCBDC9C6E659FB2385B3982E93E98D71052D
pro.			86400	IN	RRSIG	DS 8 1 86400 20200803200000 20200721190000 46594 . nIm6n8HFFi/6UTswoVBk7r6fklC30g30CpGo1+u9cvhH+qzw14btQXdI SZXrBabTZS4BSGvfxyCz8Rbz71MwNxyl/6n0VW6epeD3QB/pV2l1EC3J KG3c2fVwrF0ZVwEv520mL+MW0CU2yE6Mvw8Vb1HjWzuUkgkNvAMS0nGW QPjN/TIWZib0leySInK9ATVRDsMlas62MNejG9wI5qtO4gXWnmh7SrcG 71HOenhYzn2x+y4s678oYTgoyH+Cos77e3s4Bb7HgdDTkU0F2GZYAqsx wFKwv6Q9BfKm6RkPn7e0vFbXcbO3RgaWFzCsnPe/z7JfabUD/TauLAHm CFbHDA==
从c.root-servers.net拉取到所有pro顶级域名服务器
;; Received 842 bytes from 192.33.4.12#53(c.root-servers.net) in 271 ms

yuhao.pro.		86400	IN	NS	ns1.bdydns.cn.
yuhao.pro.		86400	IN	NS	ns2.bdydns.cn.
kp4p6t009beh7uf024robe8itfrmgqig.pro. 900 IN NSEC3 1 1 1 D399EAAB KP923TGNHEHHP0DKGQIPBJUEV47IAG41 NS SOA RRSIG DNSKEY NSEC3PARAM
kp4p6t009beh7uf024robe8itfrmgqig.pro. 900 IN RRSIG NSEC3 7 2 900 20200812033203 20200722023203 21233 pro. FyLY6TBGs74o04ZhIcU36E2E0MqTaDHVKuN2I7KMFSzF414LNkdxXC8N cBLnd70erOvG8iio7+e4MXLOiGKaN79tpoQKMSV8Sk8OX96C2GfwGAba LJAwNII/PK0EpBPVoElwbz76Y995LGnd7DtGYB9tJKpna3NwOCQEcmWH J34=
uck85dbhstr8r41ga67kbqtb3obasndh.pro. 900 IN NSEC3 1 1 1 D399EAAB UCOT87OS98FL5PBK9AMVK6Q3PRPAR9DB NS DS RRSIG
uck85dbhstr8r41ga67kbqtb3obasndh.pro. 900 IN RRSIG NSEC3 7 2 900 20200807151823 20200717141823 21233 pro. +f4QcUECnTM2RAZ6dva3vkCJ8TnX96xDSbIumNKIT1f3X6qNSnBjqE/5 UpCjxRE+duxAUP0vafx/mNBMEMqvoMP0LW8yO/d6xlh9SHyfNRiMpZ/M 6vY2ZVu87qPHG27gUz2lhz2rLJYJqERltUvSWu7P1B2aPoeCWh/L8fEa gxM=
从b0.pro.afilias-nst.org拉取到yuhao.pro的权威域名服务器
;; Received 576 bytes from 199.182.1.1#53(b0.pro.afilias-nst.org) in 208 ms

yuhao.pro.		300	IN	A	106.12.15.56
从ns2.bdydns.cn取到yuhao.pro的IP地址
;; Received 54 bytes from 112.80.248.202#53(ns2.bdydns.cn) in 5 ms
```

## DNS记录
```text
yuhao.pro.		86400	IN	NS	ns1.bdydns.cn.
yuhao.pro.: 记录名
86400: ttl
IN: type IN指代Internet
NS: Name Service 域名服务器
ns1.bdydns.cn.: 存储的值

yuhao.pro.		300	IN	A	106.12.15.56
yuhao.pro.: 记录名
300: ttl
IN: type IN指代Internet
A: A记录 指代Ipv4地址
106.12.15.56： 存储的值
```

## DNS的传输协议
DNS的传输协议是UDP，因为只请求一次就进行，没要进行TCP连接，但是同样也带来了安全问题


## 如何选择DNS
- 如果不设置，默认都是使用的ISP提供的LocalDNS
- 自己设置可以设置阿里，腾讯，114的DNS地址

## DNS劫持
- LocalDNS被控制，DNS记录被篡改，用户拿到的地址是错误的地址
- 用户访问了伪装的LocalDNS，直接就拿到了错误的地址
- 请求被拦截，并且在响应中插入了错误的地址

## 避免DNS劫持
- 使用正规的LocalDNS，如阿里，114等
- 企业可以设置备用域名


## 智能DNS
- 概念
  - 传统的DNS对于多条A记录只能进行静态轮询，而智能DNS可以根据诸如位置信息，延时信息等指标选择相对较优的IP返回
- 常见的智能DNS
  - 现在的大多数DNS都是智能DNS