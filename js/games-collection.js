// 游戏合集管理器
const GamesCollection = {
    // 游戏列表数据
    games: [
        {
            id: 'number-decomposition',
            title: '数字分解游戏',
            icon: '🔢',
            description: '学习20以内数字的分解'
        },
        {
            id: 'three-view',
            title: '三视图游戏',
            icon: '🧊',
            description: '根据三视图还原3D立方体，训练空间思维能力'
        }
        // 未来可以在这里添加更多游戏
        // {
        //     id: 'another-game',
        //     title: '另一个游戏',
        //     icon: '🎮',
        //     description: '游戏描述'
        // }
    ],

    // 当前游戏ID
    currentGameId: null,

    // 初始化游戏合集页面
    init() {
        this.renderGames();
    },

    // 渲染游戏列表
    renderGames() {
        const gamesGrid = document.getElementById('gamesGrid');
        if (!gamesGrid) return;

        gamesGrid.innerHTML = '';

        this.games.forEach(game => {
            const gameCard = document.createElement('div');
            gameCard.className = 'game-card';
            gameCard.onclick = () => this.selectGame(game.id);

            gameCard.innerHTML = `
                <div class="game-card-icon">${game.icon}</div>
                <div class="game-card-title">${game.title}</div>
                <div class="game-card-description">${game.description}</div>
            `;

            gamesGrid.appendChild(gameCard);
        });
    },

    // 选择游戏
    selectGame(gameId) {
        this.currentGameId = gameId;

        // 隐藏游戏合集页面
        document.getElementById('gamesCollectionScreen').style.display = 'none';

        // 根据游戏ID显示对应的游戏界面
        if (gameId === 'number-decomposition') {
            NumberDecompositionGame.showStartScreen();
        } else if (gameId === 'three-view') {
            ThreeViewGame.showStartScreen();
        }
        // 未来可以在这里添加其他游戏的处理
    },

    // 返回游戏合集
    backToCollection() {
        // 清理当前游戏状态
        if (this.currentGameId === 'number-decomposition') {
            NumberDecompositionGame.cleanup();
        } else if (this.currentGameId === 'three-view') {
            ThreeViewGame.cleanup();
        }

        this.currentGameId = null;

        // 隐藏所有游戏界面
        document.getElementById('startScreen').style.display = 'none';
        document.getElementById('numberInputScreen').style.display = 'none';
        document.getElementById('difficultyScreen').style.display = 'none';
        document.getElementById('gameScreen').style.display = 'none';
        document.getElementById('resultScreen').style.display = 'none';
        document.getElementById('threeViewStartScreen').style.display = 'none';
        document.getElementById('threeViewGameScreen').style.display = 'none';
        document.getElementById('threeViewResultScreen').style.display = 'none';

        // 显示游戏合集页面
        document.getElementById('gamesCollectionScreen').style.display = 'flex';
    },

    // 添加新游戏到列表
    addGame(game) {
        this.games.push(game);
        this.renderGames();
    }
};

// 将函数暴露到全局作用域，以便HTML中的onclick可以使用
function initGamesCollection() {
    GamesCollection.init();
}

function selectGame(gameId) {
    GamesCollection.selectGame(gameId);
}

function backToGamesCollection() {
    GamesCollection.backToCollection();
}
