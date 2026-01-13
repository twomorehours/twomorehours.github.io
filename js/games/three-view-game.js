// 三视图游戏模块
const ThreeViewGame = {
    // 游戏状态
    cube: [], // 2x2x2 立方体数据
    userAnswers: {
        front: [], // 用户的正视图答案
        right: [], // 用户的右视图答案
        top: [] // 用户的俯视图答案
    },
    correctViews: {
        front: [], // 正确的正视图
        right: [], // 正确的右视图
        top: [] // 正确的俯视图
    },
    timer: 0,
    timerInterval: null,

    // Three.js 相关
    scene: null,
    camera: null,
    renderer: null,
    cubes: [], // 存储所有小方块mesh

    // 初始化游戏
    init() {
        this.cube = this.createEmptyCube();
        this.userAnswers = {
            front: this.createEmptyView(),
            right: this.createEmptyView(),
            top: this.createEmptyView()
        };
        this.generateRandomCube();
        this.calculateCorrectViews();
        this.init3DScene();
        this.render3DCube();
        this.renderAnswerViews();
    },

    // 初始化3D场景
    init3DScene() {
        const container = document.getElementById('cubeContainer');
        if (!container) return;

        // 清空容器
        container.innerHTML = '';

        // 创建场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf5f5f5);

        // 创建相机 - 固定视角，可以看到三视图效果
        const width = container.clientWidth || 400;
        const height = container.clientHeight || 400;
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);

        // 设置相机位置：正对着立方体的正面
        // 立方体范围是 (0,0,0) 到 (1,1,1)，中心在 (0.5,0.5,0.5)
        this.camera.position.set(0.5, 0.5, 5);
        this.camera.lookAt(0.5, 0.5, 0.5); // 看向立方体中心

        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(this.renderer.domElement);

        // 添加轨道控制器
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // 添加环境光
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        // 添加方向光
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 5);
        this.scene.add(directionalLight);

        // 添加底板（表示地面y=0）
        const floorGeometry = new THREE.PlaneGeometry(3, 3);
        const floorMaterial = new THREE.MeshPhongMaterial({
            color: 0xe0e0e0,
            side: THREE.DoubleSide
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0.5, -0.5, 0.5); // 底板在立方体下方
        this.scene.add(floor);

        // 添加网格辅助
        const gridHelper = new THREE.GridHelper(2, 2, 0x999999, 0xcccccc);
        gridHelper.position.set(0.5, -0.5, 0.5); // 网格也在底板位置
        this.scene.add(gridHelper);

        // 添加坐标轴辅助
        const axesHelper = new THREE.AxesHelper(1.5);
        axesHelper.position.set(0.5, -0.5, 0.5); // 坐标轴从底板开始
        this.scene.add(axesHelper);

        // 渲染循环
        this.animate();
    },

    // 添加视角标注
    addViewLabels() {
        // 添加文字说明
        const instructions = [
            { text: '前视图方向 →', x: 3.5, y: 2.5, z: 1, color: '#667eea' },
            { text: '← 左视图方向', x: 1, y: 2.5, z: 3.5, color: '#667eea' },
            { text: '俯视图方向 ↓', x: 1, y: 4.5, z: 1, color: '#667eea' }
        ];

        instructions.forEach(label => {
            this.addTextLabel(label.text, label.x, label.y, label.z, label.color);
        });
    },

    // 添加文本标签
    addTextLabel(text, x, y, z, color) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 64;
        canvas.height = 64;

        context.font = 'Bold 48px Arial';
        context.fillStyle = color;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(x, y, z);
        sprite.scale.set(0.3, 0.3, 0.3);
        this.scene.add(sprite);
    },

    // 动画循环
    animate() {
        if (!this.renderer) return;

        requestAnimationFrame(() => this.animate());

        // 更新轨道控制器
        if (this.controls) {
            this.controls.update();
        }

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    },

    // 创建空的2x2x2立方体
    createEmptyCube() {
        const cube = [];
        for (let x = 0; x < 2; x++) {
            cube[x] = [];
            for (let y = 0; y < 2; y++) {
                cube[x][y] = [];
                for (let z = 0; z < 2; z++) {
                    cube[x][y][z] = 0; // 0表示空，1表示填充
                }
            }
        }
        return cube;
    },

    // 创建空的2x2视图
    createEmptyView() {
        const view = [];
        for (let i = 0; i < 2; i++) {
            view[i] = [0, 0];
        }
        return view;
    },

    // 随机生成立方体（填充一些格子，确保叠放不悬空）
    generateRandomCube() {
        // 随机填充3-7个格子（2x2x2总共8个格子）
        const fillCount = Math.floor(Math.random() * 5) + 3;
        let filled = 0;

        // 先清空
        for (let x = 0; x < 2; x++) {
            for (let y = 0; y < 2; y++) {
                for (let z = 0; z < 2; z++) {
                    this.cube[x][y][z] = 0;
                }
            }
        }

        // 逐层放置，确保每个方块都有支撑
        while (filled < fillCount) {
            // 随机选择位置
            const x = Math.floor(Math.random() * 2);
            const y = Math.floor(Math.random() * 2);
            const z = Math.floor(Math.random() * 2);

            // 检查是否可以放置
            // 1. 位置为空
            // 2. 如果不是底层(y=0)，下方必须有方块支撑
            if (this.cube[x][y][z] === 0) {
                if (y === 0 || this.cube[x][y-1][z] === 1) {
                    this.cube[x][y][z] = 1;
                    filled++;
                }
            }
        }
    },

    // 计算正确的三视图
    calculateCorrectViews() {
        // 正视图（从前往后看，投影到x-y平面）
        // 网格行：y轴（从上到下，需要反转），网格列：x轴（从左到右）
        this.correctViews.front = [];
        for (let y = 0; y < 2; y++) {
            this.correctViews.front[y] = [];
            for (let x = 0; x < 2; x++) {
                let filled = false;
                // 从前向后看，从z=1向z=0方向查找
                for (let z = 1; z >= 0; z--) {
                    if (this.cube[x][y][z] === 1) {
                        filled = true;
                        break;
                    }
                }
                // y=0在下，y=1在上，但网格行0在上，所以需要反转
                this.correctViews.front[y][x] = filled ? 1 : 0;
            }
        }
        // 反转正视图的行，让上层在上面
        this.correctViews.front.reverse();

        // 右视图（从右往左看，投影到y-z平面）
        // 网格行：y轴（从上到下），网格列：z轴（从前到后）
        this.correctViews.right = [];
        for (let y = 1; y >= 0; y--) {
            this.correctViews.right.push([]);
            for (let z = 1; z >= 0; z--) {
                let filled = false;
                // 从右往左看，从x=1向x=0方向查找
                for (let x = 1; x >= 0; x--) {
                    if (this.cube[x][y][z] === 1) {
                        filled = true;
                        break;
                    }
                }
                this.correctViews.right[this.correctViews.right.length - 1].push(filled ? 1 : 0);
            }
        }

        // 俯视图（从上往下看，投影到x-z平面）
        // 网格行：z轴（从后到前），网格列：x轴（从左到右）
        this.correctViews.top = [];
        for (let z = 0; z < 2; z++) {
            this.correctViews.top[z] = [];
            for (let x = 0; x < 2; x++) {
                let filled = false;
                // 从上往下看，从y=1向y=0方向查找
                for (let y = 1; y >= 0; y--) {
                    if (this.cube[x][y][z] === 1) {
                        filled = true;
                        break;
                    }
                }
                this.correctViews.top[z][x] = filled ? 1 : 0;
            }
        }
    },

    // 渲染3D立方体（使用Three.js）
    render3DCube() {
        if (!this.scene) return;

        // 清除旧的立方体
        this.cubes.forEach(cube => {
            this.scene.remove(cube);
        });
        this.cubes = [];

        // 创建几何体和材质 - 方块大小为1.0，让它们贴在一起
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const filledMaterial = new THREE.MeshPhongMaterial({
            color: 0x11998e,
            transparent: true,
            opacity: 0.95,
            shininess: 100
        });

        // 创建边框线条材质
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: 0x000000,
            linewidth: 2
        });

        // 只渲染填充了小方块的位置
        for (let x = 0; x < 2; x++) {
            for (let y = 0; y < 2; y++) {
                for (let z = 0; z < 2; z++) {
                    if (this.cube[x][y][z] === 1) {
                        // 计算位置
                        const posX = x;
                        const posY = y;
                        const posZ = z;

                        // 创建填充的小方块
                        const cube = new THREE.Mesh(geometry, filledMaterial);
                        cube.position.set(posX, posY, posZ);
                        this.scene.add(cube);
                        this.cubes.push(cube);

                        // 创建边框线
                        const edges = new THREE.EdgesGeometry(geometry);
                        const line = new THREE.LineSegments(edges, edgeMaterial);
                        line.position.set(posX, posY, posZ);
                        this.scene.add(line);
                        this.cubes.push(line);
                    }
                }
            }
        }
    },

    // 渲染用户作答的三视图网格
    renderAnswerViews() {
        this.renderAnswerView('frontAnswerView', 'front');
        this.renderAnswerView('rightAnswerView', 'right');
        this.renderAnswerView('topAnswerView', 'top');
    },

    // 渲染单个答案视图
    renderAnswerView(containerId, viewType) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';
        const userView = this.userAnswers[viewType];

        for (let row = 0; row < 2; row++) {
            const gridRow = document.createElement('div');
            gridRow.className = 'answer-view-row';

            for (let col = 0; col < 2; col++) {
                const cell = document.createElement('div');
                cell.className = 'answer-view-cell';
                cell.dataset.row = row;
                cell.dataset.col = col;
                cell.dataset.view = viewType;
                cell.onclick = () => this.toggleAnswerCell(viewType, row, col);

                if (userView[row][col] === 1) {
                    cell.classList.add('filled');
                }

                gridRow.appendChild(cell);
            }

            container.appendChild(gridRow);
        }
    },

    // 切换答案格子状态
    toggleAnswerCell(viewType, row, col) {
        const cell = document.querySelector(`.answer-view-cell[data-view="${viewType}"][data-row="${row}"][data-col="${col}"]`);
        if (!cell) return;

        if (this.userAnswers[viewType][row][col] === 0) {
            this.userAnswers[viewType][row][col] = 1;
            cell.classList.add('filled');
        } else {
            this.userAnswers[viewType][row][col] = 0;
            cell.classList.remove('filled');
        }
    },

    // 显示开始界面
    showStartScreen() {
        document.getElementById('threeViewStartScreen').style.display = 'flex';
    },

    // 开始游戏
    startGame() {
        document.getElementById('threeViewStartScreen').style.display = 'none';
        document.getElementById('threeViewGameScreen').style.display = 'block';
        document.getElementById('threeViewResultScreen').style.display = 'none';

        this.init();

        // 启动计时器
        this.timer = 0;
        this.timerInterval = setInterval(() => {
            this.timer++;
            document.getElementById('threeViewTimer').textContent = this.formatTime(this.timer);
        }, 1000);
    },

    // 格式化时间
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },

    // 提交答案
    submitAnswer() {
        clearInterval(this.timerInterval);

        // 计算每个视图的得分
        let totalCells = 12; // 3个视图 × 4个格子
        let correct = 0;

        // 检查正视图
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
                if (this.userAnswers.front[row][col] === this.correctViews.front[row][col]) {
                    correct++;
                }
            }
        }

        // 检查右视图
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
                if (this.userAnswers.right[row][col] === this.correctViews.right[row][col]) {
                    correct++;
                }
            }
        }

        // 检查俯视图
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
                if (this.userAnswers.top[row][col] === this.correctViews.top[row][col]) {
                    correct++;
                }
            }
        }

        const wrong = totalCells - correct;
        const score = Math.round((correct / totalCells) * 100);

        // 显示结果
        setTimeout(() => {
            document.getElementById('threeViewGameScreen').style.display = 'none';
            document.getElementById('threeViewResultScreen').style.display = 'flex';

            document.getElementById('threeViewTime').textContent = this.formatTime(this.timer);
            document.getElementById('threeViewScore').textContent = score + '%';
            document.getElementById('threeViewCorrect').textContent = correct;
            document.getElementById('threeViewTotal').textContent = totalCells;
            document.getElementById('threeViewWrong').textContent = wrong;

            // 显示答案对比
            this.showAnswerComparison();
        }, 500);
    },

    // 显示答案对比
    showAnswerComparison() {
        const container = document.getElementById('answerComparison');
        if (!container) return;

        container.innerHTML = '<h3>答案对比：</h3>';

        // 创建横向容器
        const horizontalContainer = document.createElement('div');
        horizontalContainer.className = 'view-comparisons-container';
        container.appendChild(horizontalContainer);

        // 显示每个视图的对比
        this.renderViewComparison(horizontalContainer, '正视图', 'front');
        this.renderViewComparison(horizontalContainer, '右视图', 'right');
        this.renderViewComparison(horizontalContainer, '俯视图', 'top');
    },

    // 渲染单个视图的对比
    renderViewComparison(container, viewName, viewType) {
        const section = document.createElement('div');
        section.className = 'view-comparison-section';

        section.innerHTML = `<h4>${viewName}</h4>`;

        const comparison = document.createElement('div');
        comparison.className = 'view-comparison';

        // 正确答案
        const correctDiv = document.createElement('div');
        correctDiv.className = 'comparison-col';
        correctDiv.innerHTML = '<div class="comparison-label">正确答案</div>';
        const correctGrid = this.createComparisonGrid(viewType, 'correct');
        correctDiv.appendChild(correctGrid);

        // 用户答案
        const userDiv = document.createElement('div');
        userDiv.className = 'comparison-col';
        userDiv.innerHTML = '<div class="comparison-label">你的答案</div>';
        const userGrid = this.createComparisonGrid(viewType, 'user');
        userDiv.appendChild(userGrid);

        comparison.appendChild(correctDiv);
        comparison.appendChild(userDiv);
        section.appendChild(comparison);
        container.appendChild(section);
    },

    // 创建对比网格
    createComparisonGrid(viewType, type) {
        const grid = document.createElement('div');
        grid.className = 'comparison-grid';

        const data = type === 'correct' ? this.correctViews[viewType] : this.userAnswers[viewType];
        const correct = this.correctViews[viewType];

        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
                const cell = document.createElement('div');
                cell.className = 'comparison-cell';

                const isFilled = data[row][col] === 1;
                const isCorrect = correct[row][col] === 1;

                if (type === 'correct') {
                    if (isFilled) {
                        cell.classList.add('correct-filled');
                    }
                } else {
                    // 用户答案
                    if (isFilled) {
                        if (isCorrect) {
                            cell.classList.add('user-correct');
                        } else {
                            cell.classList.add('user-wrong');
                        }
                    } else if (isCorrect) {
                        cell.classList.add('user-missed');
                    }
                }

                grid.appendChild(cell);
            }
        }

        return grid;
    },

    // 重新开始
    restartGame() {
        document.getElementById('threeViewResultScreen').style.display = 'none';
        document.getElementById('threeViewStartScreen').style.display = 'flex';
    },

    // 清理游戏状态
    cleanup() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // 清理Three.js资源
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }

        this.scene = null;
        this.camera = null;
        this.cubes = [];
    }
};

// 暴露全局函数
function startThreeViewGame() {
    ThreeViewGame.startGame();
}

function submitThreeViewAnswer() {
    ThreeViewGame.submitAnswer();
}

function restartThreeViewGame() {
    ThreeViewGame.restartGame();
}
