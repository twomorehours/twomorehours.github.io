---
title: 一个合格的Redis分布式锁
date: 2020-07-15 21:30:39
categories:
- redis
---

## 概念
分布式部署的服务对同一资源进行操作时就需要进行同步，这个时候分布式锁就派上用场了

## 使用场景
- 操作一个人的账户余额
- 分布式幂等处理


## 分布式锁要求
- 性能够用
- 能够自动释放
- 不能错误释放


## 选型
- CP   
    - zk ： 性能低
    - etcd： 性能中等，原生CAS
- AP
    - redis ： 性能高，通过lua实现CAS

一般企业中都有Redis，并且如果不是对一致性有极其高的需求，就不需要引入Ectd

## 实现
- 接口
    ```java
    package org.yuhao.springcloud.common.util.lock;

    /**
    * 分布式锁接口
    *
    * @author yuhao
    * @date 2020/7/15 4:27 下午
    */
    public interface DistributeLock {

        /**
        * 非阻塞获取锁
        *
        * @param key key
        * @param ttl 锁超时时间(ms)
        * @return 成功与否
        */
        default boolean tryLock(String key, long ttl) {
            return lock(key, ttl, 0L);
        }

        /**
        * 阻塞获取锁
        *
        * @param key key
        * @param ttl 锁超时时间(ms)
        * @return 成功与否
        */
        default boolean lock(String key, long ttl) {
            return lock(key, ttl, Long.MAX_VALUE);
        }

        /**
        * 阻塞获取锁,有阻塞时长
        *
        * @param key         key
        * @param ttl         锁超时时间(ms)
        * @param lockTimeout 获取锁超时(ms)
        * @return 成功与否
        */
        boolean lock(String key, long ttl, long lockTimeout);

        /**
        * 解锁
        *
        * @param key key
        * @return 成功与否(这里的失败表示锁已经过期)
        */
        boolean unlock(String key);
    }
    ```

- 实现
    ```java
    package org.yuhao.springcloud.common.util.lock;

    import org.springframework.core.io.ClassPathResource;
    import org.springframework.dao.DataAccessException;
    import org.springframework.data.redis.connection.RedisConnection;
    import org.springframework.data.redis.connection.RedisStringCommands;
    import org.springframework.data.redis.connection.ReturnType;
    import org.springframework.data.redis.core.RedisCallback;
    import org.springframework.data.redis.core.RedisTemplate;
    import org.springframework.data.redis.core.StringRedisTemplate;
    import org.springframework.data.redis.core.script.DefaultRedisScript;
    import org.springframework.data.redis.core.types.Expiration;

    import java.util.Arrays;
    import java.util.UUID;
    import java.util.concurrent.locks.LockSupport;

    /**
    * Redis实现的分布式锁
    *
    * @author yuhao
    * @date 2020/7/15 4:42 下午
    */
    public class RedisDistributeLock implements DistributeLock {

        /**
        * 存储val
        */
        private static ThreadLocal<String> lockValues = new ThreadLocal<>();

        /**
        * Redis操作入口
        */
        private StringRedisTemplate redisTemplate;

        /**
        * 解锁CAS脚本
        */
        private DefaultRedisScript<Integer> script;

        public RedisDistributeLock(StringRedisTemplate redisTemplate) {
            this.redisTemplate = redisTemplate;
            initScript();
        }


        @Override
        public boolean lock(String key, long ttl, long lockTimeout) {
            long start = System.currentTimeMillis();
            String value = UUID.randomUUID().toString().replace("-", "");
            do {
                boolean lock = redisTemplate.execute((RedisCallback<Boolean>) redisConnection -> {
                    Boolean set = redisConnection.set(key.getBytes(), value.getBytes(),
                            Expiration.milliseconds(ttl),
                            RedisStringCommands.SetOption.SET_IF_ABSENT);
                    return set != null && set;
                });
                if (lock) {
                    lockValues.set(value);
                    return true;
                }
                LockSupport.parkNanos(10 * 1000 * 1000);
            } while (System.currentTimeMillis() - start < lockTimeout);
            return false;
        }

        @Override
        public boolean unlock(String key) {
            String val = lockValues.get();
            if (val == null) {
                return false;
            }
            try {
                Long unlock = redisTemplate.execute(
                        (RedisCallback<Long>) connection -> connection.evalSha(script.getSha1(),
                                ReturnType.INTEGER, 1,
                                key.getBytes(), val.getBytes()));
                return unlock != null && unlock == 1L;
            } finally {
                lockValues.remove();
            }
        }

        /**
        * 启动将脚本加载到redis中 后面使用sha1代理
        */
        private void initScript() {
            script = new DefaultRedisScript<>();
            script.setLocation(new ClassPathResource("lock.lua"));
            this.redisTemplate.execute(
                    (RedisCallback<Object>) connection -> connection.scriptLoad(
                            script.getScriptAsString().getBytes()));
        }
    }
    ```
- lua脚本
    ```lua
    local key = KEYS[1]
    local val = ARGV[1]
    local currVal = redis.call("get", key)
    local result = 0
    if currVal == val then
        redis.call("del", key)
        result = 1
    end
    return result
    ```