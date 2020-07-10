---
title: 详解spring的注解事务管理
date: 2020-04-23 14:31:39
tags:
categories:
- java
- springboot
---

## 前置知识
- spring的是事务依赖数据库事务，spring本身没有事务
- 注解式事务管理是依赖AOP机制实现的
- 事务管理的顶级接口是`org.springframework.transaction.PlatformTransactionManager`
- 本文以`Mybatis`为例

## 大致流程(伪代码)
```java
    // 假设这里是代理的invoke方法
    // 这个method 就是实际要执行的业务逻辑
    public Object invoke(MethodInvocation invocation)throws Throwable;{
        // 1.取出一个Connection 并放入threadlocal中
        try{
            // 2.执行方法
            // 这个方法里面的dao要能拿到上面取到的相同的Connection
            invocation.proceed();
        }catch(Exception e){
            //3. 出错回滚
            Connection.rollback();
        }
        // 4. 成功提交
        Connection.commit();
    }
```

## 详细流程
- 取出一个Connection并开启事务
    ```java
    //org.springframework.transaction.interceptor.TransactionInterceptor#invoke
    public Object invoke(MethodInvocation invocation) throws Throwable {
		//...
		return invokeWithinTransaction(invocation.getMethod(), targetClass, invocation::proceed);
	}
    //org.springframework.transaction.interceptor.TransactionAspectSupport#invokeWithinTransaction
    protected Object invokeWithinTransaction(Method method, @Nullable Class<?> targetClass,
			final InvocationCallback invocation) throws Throwable {

        //...
		PlatformTransactionManager ptm = asPlatformTransactionManager(tm);
		final String joinpointIdentification = methodIdentification(method, targetClass, txAttr);

        // 如果@Transction为空的话 则没有事务(如果之前有事务 就会使用当前事务)
		if (txAttr == null || !(ptm instanceof CallbackPreferringPlatformTransactionManager)) {
			// 创建事务
			TransactionInfo txInfo = createTransactionIfNecessary(ptm, txAttr, joinpointIdentification);

			Object retVal;
			try {
				// 调用实际逻辑
				retVal = invocation.proceedWithInvocation();
			}
			catch (Throwable ex) {
				// 报错了回滚
				completeTransactionAfterThrowing(txInfo, ex);
				throw ex;
			}
			finally {
				cleanupTransactionInfo(txInfo);
			}

			if (vavrPresent && VavrDelegate.isVavrTry(retVal)) {
				// Set rollback-only in case of Vavr failure matching our rollback rules...
				TransactionStatus status = txInfo.getTransactionStatus();
				if (status != null && txAttr != null) {
					retVal = VavrDelegate.evaluateTryFailure(retVal, txAttr, status);
				}
			}

            // 成功提交事务
			commitTransactionAfterReturning(txInfo);
			return retVal;
		}

		//...
	}
    //org.springframework.transaction.interceptor.TransactionAspectSupport#createTransactionIfNecessary
    protected TransactionInfo createTransactionIfNecessary(@Nullable PlatformTransactionManager tm,
			@Nullable TransactionAttribute txAttr, final String joinpointIdentification) {

		//...
		TransactionStatus status = null;
		if (txAttr != null) {
			if (tm != null) {
                // 从事务管理器中取一个事务
				status = tm.getTransaction(txAttr);
			}
			else {
				if (logger.isDebugEnabled()) {
					logger.debug("Skipping transactional joinpoint [" + joinpointIdentification +
							"] because no transaction manager has been configured");
				}
			}
		}
		return prepareTransactionInfo(tm, txAttr, joinpointIdentification, status);
	}
    //org.springframework.transaction.support.AbstractPlatformTransactionManager#getTransaction
    public final TransactionStatus getTransaction(@Nullable TransactionDefinition definition)
			throws TransactionException {

		//..
        // 取出一个事务
		Object transaction = doGetTransaction();
		
        // 判断当前是否已经在事务中了
		if (isExistingTransaction(transaction)) {
			// 如果是 则走这个逻辑 这里就是事务传播相关的东西了 本次就不分析了
			return handleExistingTransaction(def, transaction, debugEnabled);
		}

		//...
        // 这里默认是PROPAGATION_REQUIRED
		else if (def.getPropagationBehavior() == TransactionDefinition.PROPAGATION_REQUIRED ||
				def.getPropagationBehavior() == TransactionDefinition.PROPAGATION_REQUIRES_NEW ||
				def.getPropagationBehavior() == TransactionDefinition.PROPAGATION_NESTED) {
			//...
			try {
                // 开启一个事务
				return startTransaction(def, transaction, debugEnabled, suspendedResources);
			}
			catch (RuntimeException | Error ex) {
				resume(null, suspendedResources);
				throw ex;
			}
		}
		//...
	}
    //org.springframework.transaction.support.AbstractPlatformTransactionManager#startTransaction
    private TransactionStatus startTransaction(TransactionDefinition definition, Object transaction,
			boolean debugEnabled, @Nullable SuspendedResourcesHolder suspendedResources) {

		boolean newSynchronization = (getTransactionSynchronization() != SYNCHRONIZATION_NEVER);
		DefaultTransactionStatus status = newTransactionStatus(
				definition, transaction, true, newSynchronization, debugEnabled, suspendedResources);
        // 开启事务
		doBegin(transaction, definition);
		prepareSynchronization(status, definition);
		return status;
	}
    //org.springframework.jdbc.datasource.DataSourceTransactionManager#doBegin
    protected void doBegin(Object transaction, TransactionDefinition definition) {
		DataSourceTransactionObject txObject = (DataSourceTransactionObject) transaction;
		Connection con = null;

		try {
			if (!txObject.hasConnectionHolder() ||
					txObject.getConnectionHolder().isSynchronizedWithTransaction()) {
                // 从连接池取一个连接
				Connection newCon = obtainDataSource().getConnection();
				if (logger.isDebugEnabled()) {
					logger.debug("Acquired Connection [" + newCon + "] for JDBC transaction");
				}
                // 保存到事务中
				txObject.setConnectionHolder(new ConnectionHolder(newCon), true);
			}

			txObject.getConnectionHolder().setSynchronizedWithTransaction(true);
			con = txObject.getConnectionHolder().getConnection();

			Integer previousIsolationLevel = DataSourceUtils.prepareConnectionForTransaction(con, definition);
			txObject.setPreviousIsolationLevel(previousIsolationLevel);
			txObject.setReadOnly(definition.isReadOnly());

			
            // 设置为非自动提交
			if (con.getAutoCommit()) {
                // 事务结束后 要设置会原来的提交状态 否则没有事务的方法永远都不能提交
				txObject.setMustRestoreAutoCommit(true);
				if (logger.isDebugEnabled()) {
					logger.debug("Switching JDBC Connection [" + con + "] to manual commit");
				}
				con.setAutoCommit(false);
			}

			prepareTransactionalConnection(con, definition);
			txObject.getConnectionHolder().setTransactionActive(true);

			int timeout = determineTimeout(definition);
			if (timeout != TransactionDefinition.TIMEOUT_DEFAULT) {
				txObject.getConnectionHolder().setTimeoutInSeconds(timeout);
			}

			// Bind the connection holder to the thread.
			if (txObject.isNewConnectionHolder()) {
                // 将获取的连接保存到ThreadLocal中 下面分析
				TransactionSynchronizationManager.bindResource(obtainDataSource(), txObject.getConnectionHolder());
			}
		}

		catch (Throwable ex) {
			if (txObject.isNewConnectionHolder()) {
				DataSourceUtils.releaseConnection(con, obtainDataSource());
				txObject.setConnectionHolder(null, false);
			}
			throw new CannotCreateTransactionException("Could not open JDBC Connection for transaction", ex);
		}
	}
    //org.springframework.transaction.support.TransactionSynchronizationManager#bindResource
    public static void bindResource(Object key, Object value) throws IllegalStateException {
		Object actualKey = TransactionSynchronizationUtils.unwrapResourceIfNecessary(key);
		Assert.notNull(value, "Value must not be null");
        // ThreadLocal Key是Datasource value是ConnectionHolder 也就是连接对象
		Map<Object, Object> map = resources.get();
		// set ThreadLocal Map if none found
		if (map == null) {
			map = new HashMap<>();
			resources.set(map);
		}
        // 放进去
		Object oldValue = map.put(actualKey, value);
		//...
	}
    ```
- Mybatis是怎么精准的取到之前的连接的
    ```java
    // 连接池声明
    @Bean(name = "dbds", initMethod = "init", destroyMethod = "close")
    public DruidDataSource getDataSource() {
        DruidDataSource dataSource = new DruidDataSource();
        dataSource.setUrl(url);
        dataSource.setUsername(userName);
        dataSource.setPassword(password);
        //..
        return dataSource;
    }
    // 事务管理器声明
    @Bean("transactionManager")
    public DataSourceTransactionManager sentinelTransactionManager(
            @Qualifier("dbds") DataSource dataSource) {
        return new DataSourceTransactionManager(dataSource);
    }
    // Mybatis声明
    @Bean(name = "dbSqlSessionFactory")
    public SqlSessionFactory getSqlSessionFactory(
            @Qualifier("dbds") DataSource ds) throws Exception {
        SqlSessionFactoryBean bean = new SqlSessionFactoryBean();
        ResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        bean.setMapperLocations(resolver.getResources("classpath:mapper/*.xml"));
        bean.setDataSource(ds);
        PageInterceptor pageInterceptor = new PageInterceptor();
        Properties properties = new Properties();
        properties.setProperty("helperDialect","mysql");
        properties.put("reasonable","true");
        properties.put("supportMethodsArguments","true");
        properties.put("autoRuntimeDialect","true");
        pageInterceptor.setProperties(properties);
        bean.setPlugins(pageInterceptor);
        return bean.getObject();
    }
    @Bean(name = "sqlSessionTemplate")
    public SqlSessionTemplate sentinelSqlSessionTemplate(
            @Qualifier("dbSqlSessionFactory") SqlSessionFactory sessionFactory) {
        return new SqlSessionTemplate(sessionFactory);
    }

    //Mybatis 接口代理的执行入口
    //org.apache.ibatis.binding.MapperProxy#invoke
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        try {
            if (Object.class.equals(method.getDeclaringClass())) {
                return method.invoke(this, args);
            } else {
                // 执行
                // 这里的sqlSession实际上就是sqlSessionTemplate
                return cachedInvoker(method).invoke(proxy, method, args, sqlSession);
            }
        } catch (Throwable t) {
            throw ExceptionUtil.unwrapThrowable(t);
        }
    }
    //org.apache.ibatis.binding.MapperMethod#execute
    public Object execute(SqlSession sqlSession, Object[] args) {
    Object result;
        switch (command.getType()) {
            // 这里仅以INSERT为例
            case INSERT: {
                Object param = method.convertArgsToSqlCommandParam(args);
                // sqlSession.insert 实际就是sqlSessionTemplate.insert()
                result = rowCountResult(sqlSession.insert(command.getName(), param));
                break;
            }
            //...
        }

        return result;
    }
    //org.mybatis.spring.SqlSessionTemplate#insert
    public int insert(String statement, Object parameter) {
        // sqlSessionProxy是对SqlSessionFactory的包装 我们来看一下
        return this.sqlSessionProxy.insert(statement, parameter);
    }
    //org.mybatis.spring.SqlSessionTemplate#SqlSessionTemplate
    public SqlSessionTemplate(SqlSessionFactory sqlSessionFactory, ExecutorType executorType,
      PersistenceExceptionTranslator exceptionTranslator) {
        //...
        // 实际调用会被指派到SqlSessionInterceptor中
        this.sqlSessionProxy = (SqlSession) newProxyInstance(SqlSessionFactory.class.getClassLoader(),
            new Class[] { SqlSession.class }, new SqlSessionInterceptor());
    }
    //org.mybatis.spring.SqlSessionTemplate.SqlSessionInterceptor#invoke
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
      // 从传入的sqlSessionFactory中取出SqlSession 连接也在这里面 所以这就话是核心
      SqlSession sqlSession = getSqlSession(SqlSessionTemplate.this.sqlSessionFactory,
          SqlSessionTemplate.this.executorType, SqlSessionTemplate.this.exceptionTranslator);
        //...
    }
    //org.mybatis.spring.SqlSessionUtils#getSqlSession
    public static SqlSession getSqlSession(SqlSessionFactory sessionFactory, ExecutorType executorType,
        //...
        LOGGER.debug(() -> "Creating a new SqlSession");
        // 创建一个连接会话
        session = sessionFactory.openSession(executorType);
        registerSessionHolder(sessionFactory, executorType, exceptionTranslator, session);
        return session;
    }
    //org.apache.ibatis.session.defaults.DefaultSqlSessionFactory#openSessionFromDataSource
    private SqlSession openSessionFromDataSource(ExecutorType execType, TransactionIsolationLevel level, boolean autoCommit) {
        Transaction tx = null;
        try {
            final Environment environment = configuration.getEnvironment();
            // 取出TransactionFactory 这个TransactionFactory是构建SessionFactory时指定的
            final TransactionFactory transactionFactory = getTransactionFactoryFromEnvironment(environment);
            // 取一个事务 这事务也就是之前开启的事物
            tx = transactionFactory.newTransaction(environment.getDataSource(), level, autoCommit);
            // 保存到executor 
            final Executor executor = configuration.newExecutor(tx, execType);
            // 后面查询数据库的链接一定是从tx中取出的
            return new DefaultSqlSession(configuration, executor, autoCommit);
        } catch (Exception e) {
            closeTransaction(tx); // may have fetched a connection so lets call close()
            throw ExceptionFactory.wrapException("Error opening session.  Cause: " + e, e);
        } finally {
            ErrorContext.instance().reset();
        }
    }
    // TransactionFactory的构建
    //org.mybatis.spring.SqlSessionFactoryBean#buildSqlSessionFactory
    protected SqlSessionFactory buildSqlSessionFactory() throws Exception {
        //...
        // 默认是SpringManagedTransactionFactory
        targetConfiguration.setEnvironment(new Environment(this.environment,
            this.transactionFactory == null ? new SpringManagedTransactionFactory() : this.transactionFactory,
            this.dataSource));
        //...
        return this.sqlSessionFactoryBuilder.build(targetConfiguration);
    }
    //org.mybatis.spring.transaction.SpringManagedTransactionFactory#newTransaction
    public Transaction newTransaction(DataSource dataSource, TransactionIsolationLevel level, boolean autoCommit) {
        // 返回一个SpringManagedTransaction
        return new SpringManagedTransaction(dataSource);
    }
    //org.mybatis.spring.transaction.SpringManagedTransaction#getConnection
    public Connection getConnection() throws SQLException {
        if (this.connection == null) {
            // 开启一个连接
            openConnection();
        }
        return this.connection;
    }
    //org.mybatis.spring.transaction.SpringManagedTransaction#openConnection
    private void openConnection() throws SQLException {
        // 取链接
        this.connection = DataSourceUtils.getConnection(this.dataSource);
        this.autoCommit = this.connection.getAutoCommit();
        this.isConnectionTransactional = DataSourceUtils.isConnectionTransactional(this.connection, this.dataSource);

        LOGGER.debug(() -> "JDBC Connection [" + this.connection + "] will"
        + (this.isConnectionTransactional ? " " : " not ") + "be managed by Spring");
    }
    //org.springframework.jdbc.datasource.DataSourceUtils#doGetConnection
    public static Connection doGetConnection(DataSource dataSource) throws SQLException {
		Assert.notNull(dataSource, "No DataSource specified");
        // 这里就是去取之前放在ThreadLocal中的链接
		ConnectionHolder conHolder = (ConnectionHolder) TransactionSynchronizationManager.getResource(dataSource);
		return conHolder.getCon();
	}
    //org.springframework.transaction.support.TransactionSynchronizationManager#doGetResource
    private static Object doGetResource(Object actualKey) {
        // 这就是之前放进去的
		Map<Object, Object> map = resources.get();
		if (map == null) {
			return null;
		}
		Object value = map.get(actualKey);
		//...
	}
    ```

- 提交事务
    ```java
    //org.springframework.transaction.interceptor.TransactionAspectSupport#commitTransactionAfterReturning
    protected void commitTransactionAfterReturning(@Nullable TransactionInfo txInfo) {
		if (txInfo != null && txInfo.getTransactionStatus() != null) {
			if (logger.isTraceEnabled()) {
				logger.trace("Completing transaction for [" + txInfo.getJoinpointIdentification() + "]");
			}
			txInfo.getTransactionManager().commit(txInfo.getTransactionStatus());
		}
	}
    //org.springframework.transaction.support.AbstractPlatformTransactionManager#commit
    public final void commit(TransactionStatus status) throws TransactionException {
		//...
		processCommit(defStatus);
	}
    //org.springframework.transaction.support.AbstractPlatformTransactionManager#processCommit
    private void processCommit(DefaultTransactionStatus status) throws TransactionException {
		try {
                //...
				// 提交
                doCommit(status);
				
		}finally {
            // 处理收尾逻辑
			cleanupAfterCompletion(status);
		}
	}
    //org.springframework.jdbc.datasource.DataSourceTransactionManager#doCommit
    protected void doCommit(DefaultTransactionStatus status) {
		DataSourceTransactionObject txObject = (DataSourceTransactionObject) status.getTransaction();
		Connection con = txObject.getConnectionHolder().getConnection();
		if (status.isDebug()) {
			logger.debug("Committing JDBC transaction on Connection [" + con + "]");
		}
		try {
            // 调用JDBC远程connection提交
			con.commit();
		}
		catch (SQLException ex) {
			throw new TransactionSystemException("Could not commit JDBC transaction", ex);
		}
	}
    //org.springframework.transaction.support.AbstractPlatformTransactionManager#cleanupAfterCompletion
    private void cleanupAfterCompletion(DefaultTransactionStatus status) {
		status.setCompleted();
		if (status.isNewSynchronization()) {
			TransactionSynchronizationManager.clear();
		}
		if (status.isNewTransaction()) {
            // 收尾处理
			doCleanupAfterCompletion(status.getTransaction());
		}
        //..
	}
    //org.springframework.jdbc.datasource.DataSourceTransactionManager#doCleanupAfterCompletion
    protected void doCleanupAfterCompletion(Object transaction) {
		DataSourceTransactionObject txObject = (DataSourceTransactionObject) transaction;

		// 将链接与当前线程解除绑定 从ThreadLocal中移除
		if (txObject.isNewConnectionHolder()) {
			TransactionSynchronizationManager.unbindResource(obtainDataSource());
		}

		// 将AutoCommit设置回原来的状态
		Connection con = txObject.getConnectionHolder().getConnection();
		try {
			if (txObject.isMustRestoreAutoCommit()) {
				con.setAutoCommit(true);
			}
			DataSourceUtils.resetConnectionAfterTransaction(
					con, txObject.getPreviousIsolationLevel(), txObject.isReadOnly());
		}
		catch (Throwable ex) {
			logger.debug("Could not reset JDBC Connection after transaction", ex);
		}

		if (txObject.isNewConnectionHolder()) {
			if (logger.isDebugEnabled()) {
				logger.debug("Releasing JDBC Connection [" + con + "] after transaction");
			}
            // 将连接放回连接池
			DataSourceUtils.releaseConnection(con, this.dataSource);
		}

		txObject.getConnectionHolder().clear();
	}
    ```

- 回滚事务
rollback的过程和commit的过程一致，除了一个调用commit，一个调用rollback 