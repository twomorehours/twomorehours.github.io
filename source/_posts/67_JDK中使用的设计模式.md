---
title: JDK中使用的设计模式
date: 2020-04-30 21:30:39
categories:
- 程序设计
---

## Calender中的工厂模式
```java
//java.util.Calendar#getInstance()
// 静态方法创建对象
public static Calendar getInstance(){
    return createCalendar(TimeZone.getDefault(), Locale.getDefault(Locale.Category.FORMAT));
}
//java.util.Calendar#createCalendar
private static Calendar createCalendar(TimeZone zone,
                                           Locale aLocale){
    CalendarProvider provider =
        LocaleProviderAdapter.getAdapter(CalendarProvider.class, aLocale)
                                .getCalendarProvider();
    if (provider != null) {
        try {
            return provider.getInstance(zone, aLocale);
        } catch (IllegalArgumentException iae) {
            // fall back to the default instantiation
        }
    }

    Calendar cal = null;

    // 根据不停的参数类型创建不同的对象
    if (aLocale.hasExtensions()) {
        String caltype = aLocale.getUnicodeLocaleType("ca");
        if (caltype != null) {
            switch (caltype) {
            case "buddhist":
            cal = new BuddhistCalendar(zone, aLocale);
                break;
            case "japanese":
                cal = new JapaneseImperialCalendar(zone, aLocale);
                break;
            case "gregory":
                cal = new GregorianCalendar(zone, aLocale);
                break;
            }
        }
    }
    if (cal == null) {
        // If no known calendar type is explicitly specified,
        // perform the traditional way to create a Calendar:
        // create a BuddhistCalendar for th_TH locale,
        // a JapaneseImperialCalendar for ja_JP_JP locale, or
        // a GregorianCalendar for any other locales.
        // NOTE: The language, country and variant strings are interned.
        if (aLocale.getLanguage() == "th" && aLocale.getCountry() == "TH") {
            cal = new BuddhistCalendar(zone, aLocale);
        } else if (aLocale.getVariant() == "JP" && aLocale.getLanguage() == "ja"
                    && aLocale.getCountry() == "JP") {
            cal = new JapaneseImperialCalendar(zone, aLocale);
        } else {
            cal = new GregorianCalendar(zone, aLocale);
        }
    }
    return cal;
}
```

## Calendar中的建造者模式
通过静态内部类的方式实现，可以和`getInstance()`相互替换使用
```java
//java.util.Calendar.Builder
public static class Builder {
    private static final int NFIELDS = FIELD_COUNT + 1; // +1 for WEEK_YEAR
    private static final int WEEK_YEAR = FIELD_COUNT;

    private long instant;
    // Calendar.stamp[] (lower half) and Calendar.fields[] (upper half) combined
    private int[] fields;
    // Pseudo timestamp starting from MINIMUM_USER_STAMP.
    // (COMPUTED is used to indicate that the instant has been set.)
    private int nextStamp;
    // maxFieldIndex keeps the max index of fields which have been set.
    // (WEEK_YEAR is never included.)
    private int maxFieldIndex;
    private String type;
    private TimeZone zone;
    private boolean lenient = true;
    private Locale locale;
    private int firstDayOfWeek, minimalDaysInFirstWeek;

    /**
        * Constructs a {@code Calendar.Builder}.
        */
    public Builder() {
    }

    //...
    // 省略很多set
    
    public Calendar build() {
        if (locale == null) {
            locale = Locale.getDefault();
        }
        if (zone == null) {
            zone = TimeZone.getDefault();
        }
        Calendar cal;
        if (type == null) {
            type = locale.getUnicodeLocaleType("ca");
        }
        if (type == null) {
            if (locale.getCountry() == "TH"
                && locale.getLanguage() == "th") {
                type = "buddhist";
            } else {
                type = "gregory";
            }
        }
        switch (type) {
        case "gregory":
            cal = new GregorianCalendar(zone, locale, true);
            break;
        case "iso8601":
            GregorianCalendar gcal = new GregorianCalendar(zone, locale, true);
            // make gcal a proleptic Gregorian
            gcal.setGregorianChange(new Date(Long.MIN_VALUE));
            // and week definition to be compatible with ISO 8601
            setWeekDefinition(MONDAY, 4);
            cal = gcal;
            break;
        case "buddhist":
            cal = new BuddhistCalendar(zone, locale);
            cal.clear();
            break;
        case "japanese":
            cal = new JapaneseImperialCalendar(zone, locale, true);
            break;
        default:
            throw new IllegalArgumentException("unknown calendar type: " + type);
        }
        cal.setLenient(lenient);
        if (firstDayOfWeek != 0) {
            cal.setFirstDayOfWeek(firstDayOfWeek);
            cal.setMinimalDaysInFirstWeek(minimalDaysInFirstWeek);
        }
        if (isInstantSet()) {
            cal.setTimeInMillis(instant);
            cal.complete();
            return cal;
        }

        if (fields != null) {
            boolean weekDate = isSet(WEEK_YEAR)
                                    && fields[WEEK_YEAR] > fields[YEAR];
            if (weekDate && !cal.isWeekDateSupported()) {
                throw new IllegalArgumentException("week date is unsupported by " + type);
            }

            // Set the fields from the min stamp to the max stamp so that
            // the fields resolution works in the Calendar.
            for (int stamp = MINIMUM_USER_STAMP; stamp < nextStamp; stamp++) {
                for (int index = 0; index <= maxFieldIndex; index++) {
                    if (fields[index] == stamp) {
                        cal.set(index, fields[NFIELDS + index]);
                        break;
                    }
                }
            }

            if (weekDate) {
                int weekOfYear = isSet(WEEK_OF_YEAR) ? fields[NFIELDS + WEEK_OF_YEAR] : 1;
                int dayOfWeek = isSet(DAY_OF_WEEK)
                                ? fields[NFIELDS + DAY_OF_WEEK] : cal.getFirstDayOfWeek();
                cal.setWeekDate(fields[NFIELDS + WEEK_YEAR], weekOfYear, dayOfWeek);
            }
            cal.complete();
        }

        return cal;
    }
}
```

## Collections中的装饰者模式
```java
//java.util.Collections#unmodifiableCollection
public static <T> Collection<T> unmodifiableCollection(Collection<? extends T> c) {
    return new UnmodifiableCollection<>(c);
}
//java.util.Collections.UnmodifiableCollection
// 继承相同的接口
// 采用组合的方式进行装饰
static class UnmodifiableCollection<E> implements Collection<E>, Serializable {
        private static final long serialVersionUID = 1820017752578914078L;

    final Collection<? extends E> c;

    UnmodifiableCollection(Collection<? extends E> c) {
        if (c==null)
            throw new NullPointerException();
        this.c = c;
    }

    public int size()                   {return c.size();}
    public boolean isEmpty()            {return c.isEmpty();}
    public boolean contains(Object o)   {return c.contains(o);}
    public Object[] toArray()           {return c.toArray();}
    public <T> T[] toArray(T[] a)       {return c.toArray(a);}
    public String toString()            {return c.toString();}

    public Iterator<E> iterator() {
        return new Iterator<E>() {
            private final Iterator<? extends E> i = c.iterator();

            public boolean hasNext() {return i.hasNext();}
            public E next()          {return i.next();}
            public void remove() {
                throw new UnsupportedOperationException();
            }
            @Override
            public void forEachRemaining(Consumer<? super E> action) {
                // Use backing collection version
                i.forEachRemaining(action);
            }
        };
    }

    public boolean add(E e) {
        throw new UnsupportedOperationException();
    }
    public boolean remove(Object o) {
        throw new UnsupportedOperationException();
    }

    public boolean containsAll(Collection<?> coll) {
        return c.containsAll(coll);
    }
    public boolean addAll(Collection<? extends E> coll) {
        throw new UnsupportedOperationException();
    }
    public boolean removeAll(Collection<?> coll) {
        throw new UnsupportedOperationException();
    }
    public boolean retainAll(Collection<?> coll) {
        throw new UnsupportedOperationException();
    }
    public void clear() {
        throw new UnsupportedOperationException();
    }

    // Override default methods in Collection
    @Override
    public void forEach(Consumer<? super E> action) {
        c.forEach(action);
    }
    @Override
    public boolean removeIf(Predicate<? super E> filter) {
        throw new UnsupportedOperationException();
    }
    @SuppressWarnings("unchecked")
    @Override
    public Spliterator<E> spliterator() {
        return (Spliterator<E>)c.spliterator();
    }
    @SuppressWarnings("unchecked")
    @Override
    public Stream<E> stream() {
        return (Stream<E>)c.stream();
    }
    @SuppressWarnings("unchecked")
    @Override
    public Stream<E> parallelStream() {
        return (Stream<E>)c.parallelStream();
    }
}
```

## Observer中的观察者模式
```java
//java.util.Observer
public interface Observer {
    void update(Observable o, Object arg);
}
//java.util.Observable
public class Observable {
    private boolean changed = false;
    private Vector<Observer> obs;

    /** Construct an Observable with zero Observers. */

    public Observable() {
        obs = new Vector<>();
    }

    // 添加观察者
    public synchronized void addObserver(Observer o) {
        if (o == null)
            throw new NullPointerException();
        if (!obs.contains(o)) {
            obs.addElement(o);
        }
    }

    // 移除
    public synchronized void deleteObserver(Observer o) {
        obs.removeElement(o);
    }


    public void notifyObservers() {
        notifyObservers(null);
    }

    // 通知观察者
    public void notifyObservers(Object arg) {
        /*
         * a temporary array buffer, used as a snapshot of the state of
         * current Observers.
         */
        Object[] arrLocal;

        synchronized (this) {
            // 这个change有两个作用
            // 1.多个线程同时通知的只需要最终通知一次
            // 2.减小锁的使用力度 缩短线程的等待时间
            if (!changed)
                return;
            arrLocal = obs.toArray();
            clearChanged();
        }

        for (int i = arrLocal.length-1; i>=0; i--)
            ((Observer)arrLocal[i]).update(this, arg);
    }

    // 移除所有
    public synchronized void deleteObservers() {
        obs.removeAllElements();
    }

    // 设置为变动
    protected synchronized void setChanged() {
        changed = true;
    }

    // 清除变动状态
    protected synchronized void clearChanged() {
        changed = false;
    }

    // 是否变动了
    public synchronized boolean hasChanged() {
        return changed;
    }

    // 观察者的个数
    public synchronized int countObservers() {
        return obs.size();
    }
}
```

## Runtime中的单例模式
```java
//java.lang.Runtime
public class Runtime {
    // 饿汉式
    private static Runtime currentRuntime = new Runtime();

    public static Runtime getRuntime() {
        return currentRuntime;
    }

    /** Don't let anyone else instantiate this class */
    private Runtime() {}
}
```