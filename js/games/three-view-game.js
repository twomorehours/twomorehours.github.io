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

        // 设置相机位置：从xy轴角平分线的垂线为轴，向屏幕外旋转30度
        // 立方体范围是 (0,0,0) 到 (2,2,2)，中心在 (1,1,1)
        // 旋转轴：(1, 0, -1)，归一化为 (1/√2, 0, -1/√2)
        const distance = 8.8; // 距离中心的距离（11 * 0.8 = 8.8，放大20%）
        const center = new THREE.Vector3(1, 1, 1);

        // 正视图位置（从z轴正方向看）
        const frontPos = new THREE.Vector3(1, 1, 12);

        // 从正视图绕y轴（绿色线）顺时针旋转25度（45-20）得到的位置
        const angleY = 25 * Math.PI / 180; // 25度
        const leftRotatedPos = new THREE.Vector3(
            1 + distance * Math.sin(angleY),
            1,
            1 + distance * Math.cos(angleY)
        );

        // 旋转轴：xy轴角平分线的垂线 (1, 0, -1)，归一化
        const axis = new THREE.Vector3(1, 0, -1).normalize();

        // 从leftRotatedPos相对于中心的向量
        const relativePos = leftRotatedPos.clone().sub(center);

        // 绕轴旋转-30度（向屏幕外）
        const angle30 = -Math.PI / 6; // -30度
        relativePos.applyAxisAngle(axis, angle30);

        // 最终位置
        this.camera.position.copy(center.clone().add(relativePos));
        this.camera.lookAt(center);

        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(this.renderer.domElement);

        // 添加轨道控制器
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.enableZoom = false; // 禁用缩放

        // 添加环境光
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        // 添加方向光
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 5);
        this.scene.add(directionalLight);

        // 添加底板（表示地面y=0）
        const floorGeometry = new THREE.PlaneGeometry(4, 4);
        const floorMaterial = new THREE.MeshPhongMaterial({
            color: 0xe0e0e0,
            side: THREE.DoubleSide
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(1, -0.5, 1); // 底板在立方体下方
        this.scene.add(floor);

        // 添加网格辅助
        const gridHelper = new THREE.GridHelper(3, 3, 0x999999, 0xcccccc);
        gridHelper.position.set(1, -0.5, 1); // 网格也在底板位置
        this.scene.add(gridHelper);

        // 添加加粗的坐标轴
        this.createThickAxes();

        // 渲染循环
        this.animate();
    },

    // 创建加粗的坐标轴
    createThickAxes() {
        const axisLength = 2.5;
        const thickness = 0.08; // 减小粗细
        const center = new THREE.Vector3(1, 1, 1); // 3×3×3中心

        // 创建坐标轴材质 - 使用高亮颜色
        const redMaterial = new THREE.MeshBasicMaterial({ color: 0xff3333 });
        const greenMaterial = new THREE.MeshBasicMaterial({ color: 0x33ff33 });
        const blueMaterial = new THREE.MeshBasicMaterial({ color: 0x3333ff });

        // X轴 (红色) - 从中心向+x方向延伸（正视图方向）
        const xAxisGeom = new THREE.CylinderGeometry(thickness, thickness, axisLength, 16);
        const xAxis = new THREE.Mesh(xAxisGeom, redMaterial);
        xAxis.rotation.z = -Math.PI / 2;
        xAxis.position.set(center.x + axisLength / 2, center.y, center.z);
        this.scene.add(xAxis);
        this.cubes.push(xAxis);

        // Y轴 (绿色) - 从中心向+y方向延伸（上方）
        const yAxisGeom = new THREE.CylinderGeometry(thickness, thickness, axisLength, 16);
        const yAxis = new THREE.Mesh(yAxisGeom, greenMaterial);
        yAxis.position.set(center.x, center.y + axisLength / 2, center.z);
        this.scene.add(yAxis);
        this.cubes.push(yAxis);

        // Z轴 (蓝色) - 从中心向+z方向延伸（深度方向）
        const zAxisGeom = new THREE.CylinderGeometry(thickness, thickness, axisLength, 16);
        const zAxis = new THREE.Mesh(zAxisGeom, blueMaterial);
        zAxis.rotation.x = Math.PI / 2;
        zAxis.position.set(center.x, center.y, center.z + axisLength / 2);
        this.scene.add(zAxis);
        this.cubes.push(zAxis);
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

    // 创建空的3x3x3立方体
    createEmptyCube() {
        const cube = [];
        for (let x = 0; x < 3; x++) {
            cube[x] = [];
            for (let y = 0; y < 3; y++) {
                cube[x][y] = [];
                for (let z = 0; z < 3; z++) {
                    cube[x][y][z] = 0; // 0表示空，1表示填充
                }
            }
        }
        return cube;
    },

    // 创建空的3x3视图
    createEmptyView() {
        const view = [];
        for (let i = 0; i < 3; i++) {
            view[i] = [0, 0, 0];
        }
        return view;
    },

    // 随机生成立方体（填充一些格子，确保叠放不悬空）
    generateRandomCube() {
        let validCube = false;

        // 不断尝试直到满足所有条件
        while (!validCube) {
            // 随机填充10-20个格子（3x3x3总共27个格子）
            const fillCount = Math.floor(Math.random() * 11) + 10;
            let filled = 0;

            // 先清空
            for (let x = 0; x < 3; x++) {
                for (let y = 0; y < 3; y++) {
                    for (let z = 0; z < 3; z++) {
                        this.cube[x][y][z] = 0;
                    }
                }
            }

            // 逐层放置，确保每个方块都有支撑
            while (filled < fillCount) {
                // 随机选择位置
                const x = Math.floor(Math.random() * 3);
                const y = Math.floor(Math.random() * 3);
                const z = Math.floor(Math.random() * 3);

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

            // 检查最高处和最低处的差值是否 <= 2
            const heightDiff = this.calculateHeightDifference();
            // 检查从初始视角是否所有方块都至少部分可见
            const allVisible = this.checkAllCubesVisibleFromInitialView();
            // 检查相邻柱之间高度差是否 <= 1
            const adjacentHeightDiffOk = this.checkAdjacentColumnHeightDiff();
            // 检查从前到后、从右到左柱的高度是非递减的
            const heightMonotonicityOk = this.checkColumnHeightMonotonicity();

            if (heightDiff <= 2 && allVisible && adjacentHeightDiffOk && heightMonotonicityOk) {
                validCube = true;
            }
        }
    },

    // 检查相邻柱之间高度差是否 <= 1
    checkAdjacentColumnHeightDiff() {
        // 计算每个柱的高度（每个x,z位置的最高y坐标）
        const columnHeights = [];
        for (let x = 0; x < 3; x++) {
            columnHeights[x] = [];
            for (let z = 0; z < 3; z++) {
                columnHeights[x][z] = this.getColumnHeight(x, z);
            }
        }

        // 检查所有相邻的柱（包括水平、垂直和对角相邻）
        for (let x = 0; x < 3; x++) {
            for (let z = 0; z < 3; z++) {
                // 检查右边的柱
                if (x < 2) {
                    const diff = Math.abs(columnHeights[x][z] - columnHeights[x + 1][z]);
                    if (diff > 1) return false;
                }
                // 检查下边的柱
                if (z < 2) {
                    const diff = Math.abs(columnHeights[x][z] - columnHeights[x][z + 1]);
                    if (diff > 1) return false;
                }
                // 检查右下对角的柱
                if (x < 2 && z < 2) {
                    const diff = Math.abs(columnHeights[x][z] - columnHeights[x + 1][z + 1]);
                    if (diff > 1) return false;
                }
                // 检查左下对角的柱
                if (x > 0 && z < 2) {
                    const diff = Math.abs(columnHeights[x][z] - columnHeights[x - 1][z + 1]);
                    if (diff > 1) return false;
                }
            }
        }

        return true;
    },

    // 获取指定位置(x,z)的柱高度（最高y坐标）
    getColumnHeight(x, z) {
        // 从上往下找第一个填充的方块
        for (let y = 2; y >= 0; y--) {
            if (this.cube[x][y][z] === 1) {
                return y + 1; // 返回高度（y=0时高度为1，y=2时高度为3）
            }
        }
        return 0; // 该柱没有方块
    },

    // 检查柱高度的单调性
    checkColumnHeightMonotonicity() {
        // 计算每个柱的高度
        const columnHeights = [];
        for (let x = 0; x < 3; x++) {
            columnHeights[x] = [];
            for (let z = 0; z < 3; z++) {
                columnHeights[x][z] = this.getColumnHeight(x, z);
            }
        }

        // 检查正视图方向：从前到后（z轴方向）
        // 要求：前面的柱高度必须 >= 后面的柱高度（前面高后面低）
        for (let x = 0; x < 3; x++) {
            for (let z = 0; z < 2; z++) {
                // 如果前面的柱高度 < 后面的柱高度，违反条件
                if (columnHeights[x][z] < columnHeights[x][z + 1]) {
                    return false;
                }
            }
        }

        // 检查右视图方向：从右到左（x轴方向）
        // 要求：右边的柱高度必须 >= 左边的柱高度（右边高左边低）
        for (let z = 0; z < 3; z++) {
            for (let x = 0; x < 2; x++) {
                // 如果右边的柱高度 < 左边的柱高度，违反条件
                if (columnHeights[x][z] < columnHeights[x + 1][z]) {
                    return false;
                }
            }
        }

        return true;
    },

    // 检查从初始视角看是否所有方块都至少部分可见
    checkAllCubesVisibleFromInitialView() {
        // 初始视角方向向量：从相机位置看向中心(1,1,1)
        // 相机位置大约是 (1+distance*sin(45°), 1, 1+distance*cos(45°)) 再绕轴旋转-30度
        // 简化计算：使用从立方体右前上方往左后下方看的视角

        for (let x = 0; x < 3; x++) {
            for (let y = 0; y < 3; y++) {
                for (let z = 0; z < 3; z++) {
                    if (this.cube[x][y][z] === 1) {
                        // 检查这个方块是否被其他方块完全遮挡
                        if (this.isCubeCompletelyHidden(x, y, z)) {
                            return false;
                        }
                    }
                }
            }
        }
        return true;
    },

    // 检查指定位置的方块是否被完全遮挡
    isCubeCompletelyHidden(x, y, z) {
        // 从初始视角（右前上方往左后下方看）检查遮挡
        // 视角方向大致是：x增加，z增加，y增加的方向更容易看到

        // 检查是否有"外露面"
        // 初始视角从右前上方看，所以检查6个面是否有暴露
        const directions = [
            { dx: 1, dy: 0, dz: 0 },  // +x方向（右）
            { dx: -1, dy: 0, dz: 0 }, // -x方向（左）
            { dx: 0, dy: 1, dz: 0 },  // +y方向（上）
            { dx: 0, dy: -1, dz: 0 }, // -y方向（下）
            { dx: 0, dy: 0, dz: 1 },  // +z方向（后）
            { dx: 0, dy: 0, dz: -1 }  // -z方向（前）
        ];

        let hasExposedFace = false;

        for (const dir of directions) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            const nz = z + dir.dz;

            // 如果这个方向的相邻位置为空或超出边界，说明这个面是暴露的
            if (nx < 0 || nx >= 3 || ny < 0 || ny >= 3 || nz < 0 || nz >= 3) {
                hasExposedFace = true;
                break;
            }

            if (this.cube[nx][ny][nz] === 0) {
                hasExposedFace = true;
                break;
            }
        }

        return !hasExposedFace; // 如果没有任何暴露的面，则被完全遮挡
    },

    // 计算立方体最高处和最低处的差值
    calculateHeightDifference() {
        let minY = 2; // 初始化为最高可能的y坐标
        let maxY = 0; // 初始化为最低可能的y坐标

        // 遍历所有位置，找到有方块的最低和最高y坐标
        for (let x = 0; x < 3; x++) {
            for (let y = 0; y < 3; y++) {
                for (let z = 0; z < 3; z++) {
                    if (this.cube[x][y][z] === 1) {
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
        }

        // 返回高度差
        return maxY - minY;
    },

    // 计算正确的三视图
    calculateCorrectViews() {
        // 正视图（从前往后看，投影到x-y平面）
        // 网格行：y轴（从上到下，需要反转），网格列：x轴（从左到右）
        this.correctViews.front = [];
        for (let y = 0; y < 3; y++) {
            this.correctViews.front[y] = [];
            for (let x = 0; x < 3; x++) {
                let filled = false;
                // 从前向后看，从z=2向z=0方向查找
                for (let z = 2; z >= 0; z--) {
                    if (this.cube[x][y][z] === 1) {
                        filled = true;
                        break;
                    }
                }
                // y=0在下，y=2在上，但网格行0在上，所以需要反转
                this.correctViews.front[y][x] = filled ? 1 : 0;
            }
        }
        // 反转正视图的行，让上层在上面
        this.correctViews.front.reverse();

        // 右视图（从右往左看，投影到y-z平面）
        // 网格行：y轴（从上到下），网格列：z轴（从前到后）
        this.correctViews.right = [];
        for (let y = 2; y >= 0; y--) {
            this.correctViews.right.push([]);
            for (let z = 2; z >= 0; z--) {
                let filled = false;
                // 从右往左看，从x=2向x=0方向查找
                for (let x = 2; x >= 0; x--) {
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
        for (let z = 0; z < 3; z++) {
            this.correctViews.top[z] = [];
            for (let x = 0; x < 3; x++) {
                let filled = false;
                // 从上往下看，从y=2向y=0方向查找
                for (let y = 2; y >= 0; y--) {
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
        for (let x = 0; x < 3; x++) {
            for (let y = 0; y < 3; y++) {
                for (let z = 0; z < 3; z++) {
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

        // 重新添加坐标轴
        this.createThickAxes();
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

        for (let row = 0; row < 3; row++) {
            const gridRow = document.createElement('div');
            gridRow.className = 'answer-view-row';

            for (let col = 0; col < 3; col++) {
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

        // 激活初始视角按钮
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById('initialViewBtn')?.classList.add('active');

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
        let totalCells = 27; // 3个视图 × 9个格子
        let correct = 0;

        // 检查正视图
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                if (this.userAnswers.front[row][col] === this.correctViews.front[row][col]) {
                    correct++;
                }
            }
        }

        // 检查右视图
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                if (this.userAnswers.right[row][col] === this.correctViews.right[row][col]) {
                    correct++;
                }
            }
        }

        // 检查俯视图
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
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

        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
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
    },

    // 刷新立方体（重新生成随机立方体）
    refreshCube() {
        // 重置计时器
        this.timer = 0;
        document.getElementById('threeViewTimer').textContent = '00:00';

        // 重新生成立方体
        this.cube = this.createEmptyCube();
        this.generateRandomCube();
        this.calculateCorrectViews();

        // 重置用户答案
        this.userAnswers = {
            front: this.createEmptyView(),
            right: this.createEmptyView(),
            top: this.createEmptyView()
        };

        // 重新渲染
        this.render3DCube();
        this.renderAnswerViews();

        // 重置相机到初始位置
        if (this.camera && this.controls) {
            const distance = 8.8;
            const center = new THREE.Vector3(1, 1, 1);

            // 从正视图绕y轴（绿色线）顺时针旋转25度（45-20）
            const angleY = 25 * Math.PI / 180;
            const leftRotatedPos = new THREE.Vector3(
                1 + distance * Math.sin(angleY),
                1,
                1 + distance * Math.cos(angleY)
            );

            // 旋转轴：xy轴角平分线的垂线
            const axis = new THREE.Vector3(1, 0, -1).normalize();
            const relativePos = leftRotatedPos.clone().sub(center);

            // 绕轴旋转-30度
            const angle30 = -Math.PI / 6;
            relativePos.applyAxisAngle(axis, angle30);

            this.camera.position.copy(center.clone().add(relativePos));
            this.camera.lookAt(center);
            this.controls.reset();
        }
    },

    // 切换视角
    switchView(viewType) {
        if (!this.camera || !this.controls) return;

        // 移除所有按钮的active类
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // 根据视角类型设置相机位置
        switch(viewType) {
            case 'initial':
                // 初始视角：从xy轴角平分线的垂线为轴，向屏幕外旋转30度
                const distance = 8.8;
                const center = new THREE.Vector3(1, 1, 1);
                // 从正视图绕y轴（绿色线）顺时针旋转25度（45-20）
                const angleY = 25 * Math.PI / 180;
                const leftRotatedPos = new THREE.Vector3(
                    1 + distance * Math.sin(angleY),
                    1,
                    1 + distance * Math.cos(angleY)
                );
                const axis = new THREE.Vector3(1, 0, -1).normalize();
                const relativePos = leftRotatedPos.clone().sub(center);
                const angle30 = -Math.PI / 6;
                relativePos.applyAxisAngle(axis, angle30);
                this.camera.position.copy(center.clone().add(relativePos));
                this.camera.up.set(0, 1, 0); // y轴向上
                this.camera.lookAt(center);
                break;
            case 'front':
                // 正视图：从z轴正方向看
                this.camera.position.set(1, 1, 12);
                this.camera.up.set(0, 1, 0); // y轴向上
                this.camera.lookAt(1, 1, 1);
                break;
            case 'right':
                // 右视图：从x轴正方向看
                this.camera.position.set(12, 1, 1);
                this.camera.up.set(0, 1, 0); // y轴向上
                this.camera.lookAt(1, 1, 1);
                break;
            case 'top':
                // 俯视图：从y轴正方向看（保持与正视图相同的左右方向）
                // 相当于正视图向前倒下，左右方向（x轴）保持不变
                this.camera.position.set(1, 12, 1);
                this.camera.up.set(0, 0, -1); // z轴负方向为"上"
                this.camera.lookAt(1, 1, 1);
                break;
        }

        // 更新controls
        this.controls.update();

        // 给当前按钮添加active类
        const btnId = viewType + 'ViewBtn';
        document.getElementById(btnId)?.classList.add('active');
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

function refreshThreeViewCube() {
    ThreeViewGame.refreshCube();
}

function switchToView(viewType) {
    ThreeViewGame.switchView(viewType);
}
