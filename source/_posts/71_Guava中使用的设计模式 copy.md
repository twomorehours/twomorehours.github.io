---
title: Guava中使用的设计模式
date: 2019-06-10 21:30:39
categories:
- 程序设计
---

## GuavaCache中的建造者模式
- 用法
```java
LoadingCache<Key, Graph> graphs = CacheBuilder.newBuilder()
    .maximumSize(10000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .removalListener(MY_LISTENER)
    .build(
        new CacheLoader<Key, Graph>() {
        public Graph load(Key key) throws AnyException {
            return createExpensiveGraph(key);
        }
    });
}
```
- 实现
```java
//com.google.common.cache.CacheBuilder
public final class CacheBuilder<K, V> {
 

  public CacheBuilder<K, V> initialCapacity(int initialCapacity) {
    //... check
    this.initialCapacity = initialCapacity;
    return this;
  }

  public CacheBuilder<K, V> concurrencyLevel(int concurrencyLevel) {
    //... check
    this.concurrencyLevel = concurrencyLevel;
    return this;
  }
  
  public CacheBuilder<K, V> maximumSize(long maximumSize) {
    //... check
    this.maximumSize = maximumSize;
    return this;
  }

  //set others ...

  //build
  public <K1 extends K, V1 extends V> Cache<K1, V1> build() {
    checkWeightWithWeigher();
    checkNonLoadingCache();
    return new LocalCache.LocalManualCache<>(this);
  }
}
```

## ImmutebleList中的不变模式
这个模式本身不是GOF设计模式中的一种，但是确是一种常用的模式，尤其是在并发的情况下

- 用法
```java
ImmutableList.of(1,2)
ImmutableList.copyOf(list)
```

- 单个元素实现
```java
//com.google.common.collect.ImmutableList#of(E)
public static <E> ImmutableList<E> of(E element) {
    return new SingletonImmutableList<E>(element);
}
//com.google.common.collect.SingletonImmutableList#SingletonImmutableList
final class SingletonImmutableList<E> extends ImmutableList<E> {

  final transient E element;

  SingletonImmutableList(E element) {
    this.element = checkNotNull(element);
  }

  @Override
  public E get(int index) {
    Preconditions.checkElementIndex(index, 1);
    return element;
  }

  @Override
  public UnmodifiableIterator<E> iterator() {
    return Iterators.singletonIterator(element);
  }

  @Override
  public Spliterator<E> spliterator() {
    return Collections.singleton(element).spliterator();
  }

  @Override
  public int size() {
    return 1;
  }

  @Override
  public ImmutableList<E> subList(int fromIndex, int toIndex) {
    Preconditions.checkPositionIndexes(fromIndex, toIndex, 1);
    return (fromIndex == toIndex) ? ImmutableList.<E>of() : this;
  }

  @Override
  public String toString() {
    return '[' + element.toString() + ']';
  }

  @Override
  boolean isPartialView() {
    return false;
  }
}
```

- 多个元素实现
```java
//com.google.common.collect.ImmutableList#copyOf(java.util.Collection<? extends E>)
public static <E> ImmutableList<E> copyOf(Collection<? extends E> elements) {
    if (elements instanceof ImmutableCollection) {
      @SuppressWarnings("unchecked") // all supported methods are covariant
      ImmutableList<E> list = ((ImmutableCollection<E>) elements).asList();
      return list.isPartialView() ? ImmutableList.<E>asImmutableList(list.toArray()) : list;
    }
    return construct(elements.toArray());
  }
//com.google.common.collect.ImmutableList#construct
private static <E> ImmutableList<E> construct(Object... elements) {
    return asImmutableList(checkElementsNotNull(elements));
}
//com.google.common.collect.ImmutableList#asImmutableList(java.lang.Object[], int)
static <E> ImmutableList<E> asImmutableList(Object[] elements, int length) {
    switch (length) {
      case 0:
        return of();
      case 1:
        return of((E) elements[0]);
      default:
        if (length < elements.length) {
          elements = Arrays.copyOf(elements, length);
        }
        return new RegularImmutableList<E>(elements);
    }
  }
class RegularImmutableList<E> extends ImmutableList<E> {
  static final ImmutableList<Object> EMPTY = new RegularImmutableList<>(new Object[0]);

  @VisibleForTesting final transient Object[] array;

  RegularImmutableList(Object[] array) {
    this.array = array;
  }

  @Override
  public int size() {
    return array.length;
  }

  @Override
  boolean isPartialView() {
    return false;
  }

  @Override
  Object[] internalArray() {
    return array;
  }

  @Override
  int internalArrayStart() {
    return 0;
  }

  @Override
  int internalArrayEnd() {
    return array.length;
  }

  @Override
  int copyIntoArray(Object[] dst, int dstOff) {
    System.arraycopy(array, 0, dst, dstOff, array.length);
    return dstOff + array.length;
  }

  // The fake cast to E is safe because the creation methods only allow E's
  @Override
  @SuppressWarnings("unchecked")
  public E get(int index) {
    return (E) array[index];
  }

  @SuppressWarnings("unchecked")
  @Override
  public UnmodifiableListIterator<E> listIterator(int index) {
    // for performance
    // The fake cast to E is safe because the creation methods only allow E's
    return (UnmodifiableListIterator<E>) Iterators.forArray(array, 0, array.length, index);
  }

  @Override
  public Spliterator<E> spliterator() {
    return Spliterators.spliterator(array, SPLITERATOR_CHARACTERISTICS);
  }

  // TODO(lowasser): benchmark optimizations for equals() and see if they're worthwhile
}
```

- 和JDK中不变集合的区别
  - Immutable本身不提供修改接口,而JDK是提供的（会抛出异常）
  - Immutable是深拷贝，会直接拷贝里面的元素，而不是持有原集合引用


## ForwardingCollection对装饰着模式的优化
```java
// ForwardingCollection 本身是一个装饰器模父类 
// 想要装饰Collections 只要继承这个类 而不用自己实现不需要实现的方法
// ForwardingCollection也可以任务是一个适配器
public abstract class ForwardingCollection<E> extends ForwardingObject implements Collection<E> {
  // TODO(lowasser): identify places where thread safety is actually lost

  /** Constructor for use by subclasses. */
  protected ForwardingCollection() {}

  @Override
  protected abstract Collection<E> delegate();

  @Override
  public Iterator<E> iterator() {
    return delegate().iterator();
  }

  @Override
  public int size() {
    return delegate().size();
  }

  @CanIgnoreReturnValue
  @Override
  public boolean removeAll(Collection<?> collection) {
    return delegate().removeAll(collection);
  }

  @Override
  public boolean isEmpty() {
    return delegate().isEmpty();
  }

  @Override
  public boolean contains(Object object) {
    return delegate().contains(object);
  }

  @CanIgnoreReturnValue
  @Override
  public boolean add(E element) {
    return delegate().add(element);
  }

  @CanIgnoreReturnValue
  @Override
  public boolean remove(Object object) {
    return delegate().remove(object);
  }

  @Override
  public boolean containsAll(Collection<?> collection) {
    return delegate().containsAll(collection);
  }

  @CanIgnoreReturnValue
  @Override
  public boolean addAll(Collection<? extends E> collection) {
    return delegate().addAll(collection);
  }

  @CanIgnoreReturnValue
  @Override
  public boolean retainAll(Collection<?> collection) {
    return delegate().retainAll(collection);
  }

  @Override
  public void clear() {
    delegate().clear();
  }

  @Override
  public Object[] toArray() {
    return delegate().toArray();
  }

  @CanIgnoreReturnValue
  @Override
  public <T> T[] toArray(T[] array) {
    return delegate().toArray(array);
  }

  /**
   * A sensible definition of {@link #contains} in terms of {@link #iterator}. If you override
   * {@link #iterator}, you may wish to override {@link #contains} to forward to this
   * implementation.
   *
   * @since 7.0
   */
  protected boolean standardContains(@Nullable Object object) {
    return Iterators.contains(iterator(), object);
  }

  /**
   * A sensible definition of {@link #containsAll} in terms of {@link #contains} . If you override
   * {@link #contains}, you may wish to override {@link #containsAll} to forward to this
   * implementation.
   *
   * @since 7.0
   */
  protected boolean standardContainsAll(Collection<?> collection) {
    return Collections2.containsAllImpl(this, collection);
  }

  /**
   * A sensible definition of {@link #addAll} in terms of {@link #add}. If you override {@link
   * #add}, you may wish to override {@link #addAll} to forward to this implementation.
   *
   * @since 7.0
   */
  protected boolean standardAddAll(Collection<? extends E> collection) {
    return Iterators.addAll(this, collection.iterator());
  }

  /**
   * A sensible definition of {@link #remove} in terms of {@link #iterator}, using the iterator's
   * {@code remove} method. If you override {@link #iterator}, you may wish to override {@link
   * #remove} to forward to this implementation.
   *
   * @since 7.0
   */
  protected boolean standardRemove(@Nullable Object object) {
    Iterator<E> iterator = iterator();
    while (iterator.hasNext()) {
      if (Objects.equal(iterator.next(), object)) {
        iterator.remove();
        return true;
      }
    }
    return false;
  }

  /**
   * A sensible definition of {@link #removeAll} in terms of {@link #iterator}, using the iterator's
   * {@code remove} method. If you override {@link #iterator}, you may wish to override {@link
   * #removeAll} to forward to this implementation.
   *
   * @since 7.0
   */
  protected boolean standardRemoveAll(Collection<?> collection) {
    return Iterators.removeAll(iterator(), collection);
  }

  /**
   * A sensible definition of {@link #retainAll} in terms of {@link #iterator}, using the iterator's
   * {@code remove} method. If you override {@link #iterator}, you may wish to override {@link
   * #retainAll} to forward to this implementation.
   *
   * @since 7.0
   */
  protected boolean standardRetainAll(Collection<?> collection) {
    return Iterators.retainAll(iterator(), collection);
  }

  /**
   * A sensible definition of {@link #clear} in terms of {@link #iterator}, using the iterator's
   * {@code remove} method. If you override {@link #iterator}, you may wish to override {@link
   * #clear} to forward to this implementation.
   *
   * @since 7.0
   */
  protected void standardClear() {
    Iterators.clear(iterator());
  }

  /**
   * A sensible definition of {@link #isEmpty} as {@code !iterator().hasNext}. If you override
   * {@link #isEmpty}, you may wish to override {@link #isEmpty} to forward to this implementation.
   * Alternately, it may be more efficient to implement {@code isEmpty} as {@code size() == 0}.
   *
   * @since 7.0
   */
  protected boolean standardIsEmpty() {
    return !iterator().hasNext();
  }

  /**
   * A sensible definition of {@link #toString} in terms of {@link #iterator}. If you override
   * {@link #iterator}, you may wish to override {@link #toString} to forward to this
   * implementation.
   *
   * @since 7.0
   */
  protected String standardToString() {
    return Collections2.toStringImpl(this);
  }

  /**
   * A sensible definition of {@link #toArray()} in terms of {@link #toArray(Object[])}. If you
   * override {@link #toArray(Object[])}, you may wish to override {@link #toArray} to forward to
   * this implementation.
   *
   * @since 7.0
   */
  protected Object[] standardToArray() {
    Object[] newArray = new Object[size()];
    return toArray(newArray);
  }

  /**
   * A sensible definition of {@link #toArray(Object[])} in terms of {@link #size} and {@link
   * #iterator}. If you override either of these methods, you may wish to override {@link #toArray}
   * to forward to this implementation.
   *
   * @since 7.0
   */
  protected <T> T[] standardToArray(T[] array) {
    return ObjectArrays.toArrayImpl(this, array);
  }
}
```