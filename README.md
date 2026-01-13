# 教育游戏合集

这是一个模块化的在线教育游戏平台，采用纯HTML/CSS/JavaScript开发。

## 项目结构

```
twomorehours.github.io/
├── index.html                          # 主页面文件
├── css/
│   └── styles.css                      # 全局样式文件
├── js/
│   ├── games-collection.js             # 游戏合集管理器
│   └── games/
│       └── number-decomposition.js     # 数字分解游戏模块
└── README.md                           # 项目说明文档
```

## 如何添加新游戏

### 1. 创建游戏模块

在 `js/games/` 目录下创建新的游戏文件，例如 `your-game.js`：

```javascript
// 你的游戏模块
const YourGame = {
    // 游戏状态
    state: {},

    // 初始化游戏
    init() {
        // 初始化逻辑
    },

    // 显示开始界面
    showStartScreen() {
        document.getElementById('yourGameStartScreen').style.display = 'flex';
    },

    // 开始游戏
    startGame() {
        // 游戏逻辑
    },

    // 清理游戏状态
    cleanup() {
        // 清理逻辑
    }
};

// 暴露全局函数
function yourGameFunction() {
    YourGame.someMethod();
}
```

### 2. 在游戏合集注册

在 `js/games-collection.js` 的 `games` 数组中添加你的游戏：

```javascript
games: [
    {
        id: 'your-game',
        title: '你的游戏',
        icon: '🎮',
        description: '游戏描述',
        tags: ['标签1', '标签2']
    }
]
```

### 3. 在HTML中添加游戏界面

在 `index.html` 中添加你的游戏界面元素：

```html
<!-- 你的游戏开始界面 -->
<div class="start-screen" id="yourGameStartScreen" style="display: none;">
    <h1>🎮 你的游戏</h1>
    <!-- 游戏内容 -->
</div>
```

### 4. 引入游戏脚本

在 `index.html` 中引入你的游戏脚本：

```html
<script src="js/games/your-game.js"></script>
```

### 5. 更新游戏合集逻辑

在 `js/games-collection.js` 的 `selectGame` 方法中添加处理逻辑：

```javascript
selectGame(gameId) {
    // ...
    if (gameId === 'your-game') {
        YourGame.showStartScreen();
    }
}
```

## 当前游戏

### 🔢 数字分解游戏

学习10和20的分解，通过练习模式和竞赛模式提升数学能力。

- **练习模式**: 输入一个数字(2-20)，练习该数字的所有分解组合
- **竞赛模式**: 10道题，三种难度可选
  - 简单: 全是10以内数字
  - 中等: 10以内和11-20各占一半
  - 困难: 全是11-20数字

## 技术栈

- HTML5
- CSS3 (包含动画和响应式设计)
- Vanilla JavaScript (ES6+)

## 特性

- ✅ 模块化设计，易于扩展
- ✅ 响应式布局，支持移动端
- ✅ 流畅的动画效果
- ✅ 每题耗时统计
- ✅ 详细的答题结果展示

## 开发说明

所有CSS样式集中在 `css/styles.css` 文件中，便于维护和修改。

JavaScript采用模块化设计，每个游戏都是独立的模块，通过游戏合集管理器统一调度。
