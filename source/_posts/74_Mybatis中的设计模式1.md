---
title: Mybatis中使用的设计模式
date: 2020-07-25 23:30:39
categories:
- 程序设计
---

## Plugin中的责任链和代理模式
Mybatis的Plugin实际上就是Interceptor，在执行的过程中，Mybatis内部的关键对象会被进行动态代理，在代理中执行用户声明的Interceptor，Mybatis的责任链模式是靠代理模式实现的
- 使用demo
```java
// 实现一个sql耗时的插件
// @Intercepts里面配置的@Signature标记的是对哪个类中的哪个方法进行拦截
@Intercepts({
        @Signature(type = StatementHandler.class, method = "query", args = {Statement.class, ResultHandler.class}),
        @Signature(type = StatementHandler.class, method = "update", args = {Statement.class}),
        @Signature(type = StatementHandler.class, method = "batch", args = {Statement.class})})
public class SqlCostTimeInterceptor implements Interceptor {
  private static Logger logger = LoggerFactory.getLogger(SqlCostTimeInterceptor.class);

  @Override
  public Object intercept(Invocation invocation) throws Throwable {
    Object target = invocation.getTarget();
    long startTime = System.currentTimeMillis();
    StatementHandler statementHandler = (StatementHandler) target;
    try {
      return invocation.proceed();
    } finally {
      long costTime = System.currentTimeMillis() - startTime;
      BoundSql boundSql = statementHandler.getBoundSql();
      String sql = boundSql.getSql();
      logger.info("执行 SQL：[ {} ]执行耗时[ {} ms]", sql, costTime);
    }
  }

  @Override
  public Object plugin(Object target) {
    // 统一写法 传入的就是拦截到的对象 里
    // 面的逻辑是生成动态代理  代理中调用这个Interceptor对象
    return Plugin.wrap(target, this);
  }

  @Override
  public void setProperties(Properties properties) {
    System.out.println("插件配置的信息："+properties);
  }
}
//声明
@Bean(name = "sqlSessionFactory")
    public SqlSessionFactory sqlSessionFactoryBean() {
        LOGGER.info("MyBatisConfig sqlSessionFactoryBean");
        MybatisSqlSessionFactoryBean bean = new MybatisSqlSessionFactoryBean();
        //...
        ShardingInterceptor shardingInterceptor = new ShardingInterceptor();
        PaginationInterceptor paginationInterceptor = new PaginationInterceptor();
        //添加插件
        bean.setPlugins(new Interceptor[]{shardingInterceptor,paginationInterceptor});
        //...
    }
```

- 具体实现
    - 注册拦截器，生成拦截器链
    ```java
    //org.apache.ibatis.session.Configuration#addInterceptor
    public void addInterceptor(Interceptor interceptor) {
        interceptorChain.addInterceptor(interceptor);
    }
    ```
    - 关键对象创建过程中回调configuration
    ```java
    // 创建ParameterHandler
    public ParameterHandler newParameterHandler(MappedStatement mappedStatement, Object parameterObject, BoundSql boundSql) {
        ParameterHandler parameterHandler = mappedStatement.getLang().createParameterHandler(mappedStatement, parameterObject, boundSql);
        parameterHandler = (ParameterHandler) interceptorChain.pluginAll(parameterHandler);
        return parameterHandler;
    }
    //// 创建ResultSetHandler
    public ResultSetHandler newResultSetHandler(Executor executor, MappedStatement mappedStatement, RowBounds rowBounds, ParameterHandler parameterHandler,
      ResultHandler resultHandler, BoundSql boundSql) {
        ResultSetHandler resultSetHandler = new DefaultResultSetHandler(executor, mappedStatement, parameterHandler, resultHandler, boundSql, rowBounds);
        resultSetHandler = (ResultSetHandler) interceptorChain.pluginAll(resultSetHandler);
        return resultSetHandler;
    }
    // 创建StatementHandler
    public StatementHandler newStatementHandler(Executor executor, MappedStatement mappedStatement, Object parameterObject, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql) {
        StatementHandler statementHandler = new RoutingStatementHandler(executor, mappedStatement, parameterObject, rowBounds, resultHandler, boundSql);
        statementHandler = (StatementHandler) interceptorChain.pluginAll(statementHandler);
        return statementHandler;
    }
    // 创建 Executor
    public Executor newExecutor(Transaction transaction) {
        return newExecutor(transaction, defaultExecutorType);
    }
    ```
    - 生成代理对象
    ```java
    //org.apache.ibatis.plugin.InterceptorChain#pluginAll
    public Object pluginAll(Object target) {
        for (Interceptor interceptor : interceptors) {
        target = interceptor.plugin(target);
        }
        return target;
    }
    //org.apache.ibatis.plugin.Plugin#wrap
    public static Object wrap(Object target, Interceptor interceptor) {
        // 取出这个interceptor 关联了哪些类的哪些方法
        Map<Class<?>, Set<Method>> signatureMap = getSignatureMap(interceptor);
        Class<?> type = target.getClass();
        Class<?>[] interfaces = getAllInterfaces(type, signatureMap);
        // 被拦截的对象必须有接口
        if (interfaces.length > 0) {
            //生成代理
            return Proxy.newProxyInstance(
                type.getClassLoader(),
                interfaces,
                // 代理逻辑
                new Plugin(target, interceptor, signatureMap));
            }
            return target;
    }
    //org.apache.ibatis.plugin.Plugin#invoke
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        try {
            Set<Method> methods = signatureMap.get(method.getDeclaringClass());
            // 如果这个方法是被拦截的
            if (methods != null && methods.contains(method)) {
                // 就执行intercet 并传入原来的真实对象
                return interceptor.intercept(new Invocation(target, method, args));
            }
            return method.invoke(target, args);
        } catch (Exception e) {
            throw ExceptionUtil.unwrapThrowable(e);
        }
    }
    ```
    - 代理之后的效果
    ```text
    每个拦截器都会生成一级代理对象，无论拦截几个方法
    假设现在有两个拦截器都拦截了Executor的query
    (Executor Interface).query
    => Proxy1.query 
    => Intercetor1.intercept 
    => Proxy2.query 
    => Intercetor2.intercept
    => RealExecutor.query
    ```
- 使用场景
  - Mybatis分页插件就是使用的这种方式

## Executor中的模板模式
Mybatis中的多种Executor都继承于BaseExecutor，主流程都在BaseExecutor中定义
- 具体实现
```java
//org.apache.ibatis.executor.BaseExecutor
//将几个具体实现下推到子类
public abstract class BaseExecutor implements Executor {

    //...

    protected abstract int doUpdate(MappedStatement ms, Object parameter)
      throws SQLException;

    protected abstract List<BatchResult> doFlushStatements(boolean isRollback)
      throws SQLException;

    protected abstract <E> List<E> doQuery(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql)
      throws SQLException;

    protected abstract <E> Cursor<E> doQueryCursor(MappedStatement ms, Object parameter, RowBounds rowBounds, BoundSql boundSql)
      throws SQLException;

}
//org.apache.ibatis.executor.SimpleExecutor
// SimpleExecutor的实现
public class SimpleExecutor extends BaseExecutor {

  public SimpleExecutor(Configuration configuration, Transaction transaction) {
    super(configuration, transaction);
  }

  @Override
  public int doUpdate(MappedStatement ms, Object parameter) throws SQLException {
    Statement stmt = null;
    try {
      Configuration configuration = ms.getConfiguration();
      StatementHandler handler = configuration.newStatementHandler(this, ms, parameter, RowBounds.DEFAULT, null, null);
      stmt = prepareStatement(handler, ms.getStatementLog());
      return handler.update(stmt);
    } finally {
      closeStatement(stmt);
    }
  }

  @Override
  public <E> List<E> doQuery(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql) throws SQLException {
    Statement stmt = null;
    try {
      Configuration configuration = ms.getConfiguration();
      StatementHandler handler = configuration.newStatementHandler(wrapper, ms, parameter, rowBounds, resultHandler, boundSql);
      stmt = prepareStatement(handler, ms.getStatementLog());
      return handler.<E>query(stmt, resultHandler);
    } finally {
      closeStatement(stmt);
    }
  }

  @Override
  protected <E> Cursor<E> doQueryCursor(MappedStatement ms, Object parameter, RowBounds rowBounds, BoundSql boundSql) throws SQLException {
    Configuration configuration = ms.getConfiguration();
    StatementHandler handler = configuration.newStatementHandler(wrapper, ms, parameter, rowBounds, null, boundSql);
    Statement stmt = prepareStatement(handler, ms.getStatementLog());
    return handler.<E>queryCursor(stmt);
  }

  @Override
  public List<BatchResult> doFlushStatements(boolean isRollback) throws SQLException {
    return Collections.emptyList();
  }

  private Statement prepareStatement(StatementHandler handler, Log statementLog) throws SQLException {
    Statement stmt;
    Connection connection = getConnection(statementLog);
    stmt = handler.prepare(connection, transaction.getTimeout());
    handler.parameterize(stmt);
    return stmt;
  }
}
//还有BatchExecutor等的实现
```

## ErrorContext中的单例模式
这里的单例模式并不是传统意义上的进程级别单例，而是线程级别单例，也就是大家熟知的ThreadLocal
- 具体实现
```java
//org.apache.ibatis.executor.ErrorContext
public class ErrorContext {
    //...
    
    private static final ThreadLocal<ErrorContext> LOCAL = new ThreadLocal<ErrorContext>();

    private ErrorContext() {
    }

    public static ErrorContext instance() {
        // 从线程中取出
        ErrorContext context = LOCAL.get();
        if (context == null) {
            // 为空就新建一个保存
            context = new ErrorContext();
            LOCAL.set(context);
        }
        return context;
    }
}
```