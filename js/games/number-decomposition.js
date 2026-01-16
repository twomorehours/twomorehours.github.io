// 数字分解游戏模块
const NumberDecompositionGame = {
    // 游戏状态
    questions: [],
    currentQuestionIndex: 0,
    timer: 0,
    timerInterval: null,
    results: [],
    gameStartTime: null,
    currentQuestionStartTime: null,
    currentMode: 'medium',
    totalQuestions: 10,

    // 生成指定total的分解题目
    generateQuestionsForTotal(total, count) {
        const questionList = [];
        for (let i = 0; i < count; i++) {
            const num1 = Math.floor(Math.random() * (total - 1)) + 1;
            const num2 = total - num1;

            questionList.push({
                total: total,
                num1: num1,
                correctAnswer: num2
            });
        }
        return questionList;
    },

    // 洗牌算法，随机打乱数组
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },

    // 根据模式生成题目
    generateQuestions(mode, difficulty = null, practiceNumber = null) {
        this.currentMode = mode;
        let questionList = [];

        if (mode === 'practice') {
            const num = practiceNumber || 10;
            this.totalQuestions = num - 1;

            for (let i = 1; i < num; i++) {
                questionList.push({
                    total: num,
                    num1: i,
                    correctAnswer: num - i
                });
            }

            questionList = this.shuffleArray(questionList);
        } else if (mode === 'competition') {
            this.totalQuestions = 10;

            if (difficulty === 'easy') {
                for (let i = 0; i < 10; i++) {
                    const total = Math.floor(Math.random() * 9) + 2;
                    const num1 = Math.floor(Math.random() * (total - 1)) + 1;

                    questionList.push({
                        total: total,
                        num1: num1,
                        correctAnswer: total - num1
                    });
                }
            } else if (difficulty === 'medium') {
                for (let i = 0; i < 5; i++) {
                    const total = Math.floor(Math.random() * 9) + 2;
                    const num1 = Math.floor(Math.random() * (total - 1)) + 1;

                    questionList.push({
                        total: total,
                        num1: num1,
                        correctAnswer: total - num1
                    });
                }

                for (let i = 0; i < 5; i++) {
                    const total = Math.floor(Math.random() * 10) + 11;
                    const num1 = Math.floor(Math.random() * (total - 1)) + 1;

                    questionList.push({
                        total: total,
                        num1: num1,
                        correctAnswer: total - num1
                    });
                }

                questionList = this.shuffleArray(questionList);
            } else if (difficulty === 'hard') {
                for (let i = 0; i < 10; i++) {
                    const total = Math.floor(Math.random() * 10) + 11;
                    const num1 = Math.floor(Math.random() * (total - 1)) + 1;

                    questionList.push({
                        total: total,
                        num1: num1,
                        correctAnswer: total - num1
                    });
                }
            }
        }

        return questionList;
    },

    // 格式化时间
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },

    // 创建卡片
    createCard(question, index) {
        const card = document.createElement('div');
        card.className = 'card';
        if (index === 0) {
            card.classList.add('active');
        }

        card.innerHTML = `
            <div class="card-number">${index + 1}</div>
            <div class="decomposition-container">
                <div class="total-number">${question.total}</div>
                <div class="boxes-container">
                    <div class="number-box">${question.num1}</div>
                    <div class="operator">+</div>
                    <div class="input-box">
                        <input type="number" class="card-input" id="input-${index}" placeholder="?" autocomplete="off">
                    </div>
                </div>
            </div>
            <div class="card-feedback" id="feedback-${index}"></div>
        `;

        return card;
    },

    // 初始化游戏
    initGame(mode, difficulty = null, practiceNumber = null) {
        this.questions = this.generateQuestions(mode, difficulty, practiceNumber);
        this.currentQuestionIndex = 0;
        this.timer = 0;
        this.results = [];
        this.gameStartTime = Date.now();
        this.currentQuestionStartTime = Date.now();

        document.getElementById('currentQuestion').textContent = `1/${this.totalQuestions}`;
        document.getElementById('timer').textContent = '00:00';

        const container = document.getElementById('cardsContainer');
        container.innerHTML = '';

        this.questions.forEach((question, index) => {
            const card = this.createCard(question, index);
            container.appendChild(card);
        });

        setTimeout(() => {
            const input = document.getElementById('input-0');
            if (input) {
                input.focus();
            }
        }, 100);
    },

    // 显示开始界面
    showStartScreen() {
        document.getElementById('startScreen').style.display = 'flex';
    },

    // 显示数字输入界面（练习模式）
    showNumberInput() {
        document.getElementById('startScreen').style.display = 'none';
        document.getElementById('numberInputScreen').style.display = 'flex';

        // 每次随机生成一个2-20的数字作为默认值和placeholder
        const randomNum = Math.floor(Math.random() * 19) + 2;
        const input = document.getElementById('practiceNumber');
        input.placeholder = randomNum;
        input.value = ''; // 清空之前的输入
        input.focus();
    },

    // 开始练习模式
    startPracticeMode() {
        const input = document.getElementById('practiceNumber');
        let num = parseInt(input.value);

        // 如果用户没有输入数字，使用placeholder的值作为默认值
        if (isNaN(num)) {
            num = parseInt(input.placeholder);
        }

        if (isNaN(num) || num < 2 || num > 20) {
            alert('请输入2到20之间的数字');
            return;
        }

        document.getElementById('numberInputScreen').style.display = 'none';
        document.getElementById('gameScreen').style.display = 'block';
        document.getElementById('resultScreen').style.display = 'none';

        this.initGame('practice', null, num);

        this.timerInterval = setInterval(() => {
            this.timer++;
            document.getElementById('timer').textContent = this.formatTime(this.timer);
        }, 1000);
    },

    // 显示竞赛难度选择界面
    showDifficultySelect() {
        document.getElementById('startScreen').style.display = 'none';
        document.getElementById('difficultyScreen').style.display = 'flex';
    },

    // 返回开始界面
    backToStart() {
        document.getElementById('difficultyScreen').style.display = 'none';
        document.getElementById('startScreen').style.display = 'flex';
    },

    // 开始游戏
    startGame(mode, difficulty = null) {
        document.getElementById('startScreen').style.display = 'none';
        document.getElementById('difficultyScreen').style.display = 'none';
        document.getElementById('gameScreen').style.display = 'block';
        document.getElementById('resultScreen').style.display = 'none';

        this.initGame(mode, difficulty);

        this.timerInterval = setInterval(() => {
            this.timer++;
            document.getElementById('timer').textContent = this.formatTime(this.timer);
        }, 1000);
    },

    // 检查答案
    checkAnswer(questionIndex) {
        if (questionIndex !== this.currentQuestionIndex) return;

        const question = this.questions[questionIndex];
        const userAnswer = parseInt(document.getElementById(`input-${questionIndex}`).value);
        const card = document.querySelectorAll('.card')[questionIndex];
        const feedback = document.getElementById(`feedback-${questionIndex}`);

        if (isNaN(userAnswer)) {
            feedback.textContent = '请输入数字！';
            feedback.style.color = '#f45c43';
            return;
        }

        const isCorrect = userAnswer === question.correctAnswer;
        const timeSpent = Math.round((Date.now() - this.currentQuestionStartTime) / 1000);

        this.results.push({
            question: `${question.total} = ${question.num1} + ?`,
            displayQuestion: `${question.total} 分解为 ${question.num1} 和 ?`,
            userAnswer: userAnswer,
            correctAnswer: question.correctAnswer,
            isCorrect: isCorrect,
            timeSpent: timeSpent
        });

        if (isCorrect) {
            card.classList.add('correct');
            feedback.textContent = `✓ 正确！用时 ${this.formatTime(timeSpent)}`;
        } else {
            card.classList.add('wrong');
            feedback.textContent = `✗ 正确答案是 ${question.correctAnswer}，用时 ${this.formatTime(timeSpent)}`;
        }

        document.getElementById(`input-${questionIndex}`).disabled = true;

        setTimeout(() => {
            this.moveToNextQuestion();
        }, 1500);
    },

    // 移动到下一题
    moveToNextQuestion() {
        const currentCard = document.querySelectorAll('.card')[this.currentQuestionIndex];
        currentCard.classList.remove('active');
        currentCard.classList.add('removed');

        this.currentQuestionIndex++;

        if (this.currentQuestionIndex >= this.totalQuestions) {
            this.endGame();
        } else {
            this.currentQuestionStartTime = Date.now();

            const nextCard = document.querySelectorAll('.card')[this.currentQuestionIndex];
            if (nextCard) {
                nextCard.classList.add('active');
            }

            document.getElementById('currentQuestion').textContent = `${this.currentQuestionIndex + 1}/${this.totalQuestions}`;

            setTimeout(() => {
                const nextInput = document.getElementById(`input-${this.currentQuestionIndex}`);
                if (nextInput) {
                    nextInput.focus();
                }
            }, 300);
        }
    },

    // 结束游戏
    endGame() {
        clearInterval(this.timerInterval);

        const correctCount = this.results.filter(r => r.isCorrect).length;
        const wrongCount = this.results.filter(r => !r.isCorrect).length;

        setTimeout(() => {
            document.getElementById('gameScreen').style.display = 'none';
            document.getElementById('resultScreen').style.display = 'flex';

            document.getElementById('finalTime').textContent = this.formatTime(this.timer);
            document.getElementById('correctCount').textContent = correctCount;
            document.getElementById('wrongCount').textContent = wrongCount;

            const detailsContainer = document.getElementById('resultDetails');
            detailsContainer.innerHTML = '<h3>答题详情：</h3>';

            this.results.forEach((result, index) => {
                const item = document.createElement('div');
                item.className = `result-item ${result.isCorrect ? 'correct' : 'wrong'}`;
                item.innerHTML = `
                    <span>第${index + 1}题: ${result.displayQuestion}</span>
                    <span>
                        答案: ${result.userAnswer}
                        ${!result.isCorrect ? `<span class="correct-answer">(正确: ${result.correctAnswer})</span>` : ' ✓'}
                        <span style="margin-left: 10px; color: #666;">⏱️ ${this.formatTime(result.timeSpent)}</span>
                    </span>
                `;
                detailsContainer.appendChild(item);
            });
        }, 600);
    },

    // 重新开始当前游戏
    restartGame() {
        document.getElementById('resultScreen').style.display = 'none';
        document.getElementById('startScreen').style.display = 'flex';
    },

    // 清理游戏状态
    cleanup() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
};

// 将函数暴露到全局作用域
function showNumberInput() {
    NumberDecompositionGame.showNumberInput();
}

function handleNumberInput(event) {
    if (event.key === 'Enter') {
        NumberDecompositionGame.startPracticeMode();
    }
}

function startPracticeMode() {
    NumberDecompositionGame.startPracticeMode();
}

function showDifficultySelect() {
    NumberDecompositionGame.showDifficultySelect();
}

function backToStart() {
    NumberDecompositionGame.backToStart();
}

function startGame(mode, difficulty = null) {
    NumberDecompositionGame.startGame(mode, difficulty);
}

function checkAnswer(questionIndex) {
    NumberDecompositionGame.checkAnswer(questionIndex);
}

function restartGame() {
    NumberDecompositionGame.restartGame();
}

// 键盘事件监听
document.addEventListener('keydown', (e) => {
    if (document.getElementById('gameScreen').style.display === 'none') return;

    if (e.key === 'Enter') {
        const activeElement = document.activeElement;
        if (activeElement && activeElement.classList.contains('card-input')) {
            const questionIndex = parseInt(activeElement.id.split('-')[1]);
            NumberDecompositionGame.checkAnswer(questionIndex);
        }
    }
});

// 全局键盘事件 - 监听数字输入
document.addEventListener('keypress', () => {
    if (document.getElementById('gameScreen').style.display === 'none') return;

    const activeElement = document.activeElement;
    if (!activeElement || !activeElement.classList.contains('card-input')) {
        const currentInput = document.getElementById(`input-${NumberDecompositionGame.currentQuestionIndex}`);
        if (currentInput && !currentInput.disabled) {
            currentInput.focus();
        }
    }
});
