const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const parseArgs = require('minimist');
const path = require('path');
const iconv = require('iconv-lite');
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});
const rimraf = require('rimraf');
const { exec } = require('child_process');
const { spawn } = require('child_process');
const app = express();
const port = 3001;

app.listen(port);
console.log(`Сервер запущен на порту ${port}`);
app.use(bodyParser.json());
app.use(express.static(__dirname + '../../client/build'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST");
    next();
});



// получение папки с репозиториями
// например, node app --repo=./repos
let argv = parseArgs(process.argv.slice(2));

let reposDir = argv.repo;
if (!reposDir) { // если изначально в строке не ввели путь, то попросить ввести через REPL
    readline.question('Пожалуйста, введите путь к папке с репозиториями (например, ./repos): ', repo => {
        reposDir = repo;
        readline.close();
    });
}



// Индексная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/build/index.html'));
});


// Возвращает массив репозиториев, которые имеются в папке
app.get('/api/repos', (req, res) => {
    fs.readdir(reposDir, (err, files) => {
        if (err) {
            res.send(err);
        } else {
            let repos = [];
            files.map((file, i, arr) => {
                arr[i] = new Promise((resolve, reject) => {
                    fs.stat(path.join(__dirname, reposDir, file), (err, stats) => {
                        if (stats.isDirectory()) {
                            repos.push(file);
                        }
                        resolve();
                    });
                });
            });

            Promise.all(files).then(value => res.json({
                names: repos
            }));
        }
    });
});


// Возвращает массив коммитов в данной ветке (или хэше коммита) вместе с датами их создания и названием
app.get('/api/repos/:repositoryId/commits/:commitHash', (req, res) => {

    let result = [];
    let commits = spawn(`cd ${reposDir}/${req.params.repositoryId} && git checkout ${req.params.commitHash} -q && git --no-pager log --pretty=tformat:"%H--%s--%ad"`, {
        shell: true
    });

    commits.stderr.on('data', data => {
        res.send("STDERR:", data.toString());
    });

    commits.stdout.on('data', data => {
        data = data.toString().trim().split('\n').map(el => el.split('--'));
        result.push(...data);
    });

    commits.on('close', () => {
        res.json({ data: result });
    });
});


// Возвращает diff коммита в виде строки
app.get('/api/repos/:repositoryId/commits/:commitHash/diff', (req, res) => {
    new Promise((resolve, reject) => {
            exec(`cd ${reposDir}/${req.params.repositoryId} && git cat-file -p ${req.params.commitHash}`, (err, out) => {
                if (err) {
                    reject(err);
                } else {
                    out = out.slice(out.indexOf('parent') + 7, out.indexOf('parent') + 47); //40 - длина SHA1-хеша
                    resolve(out);
                }
            });
        })
        .then(parentHash => {

            let result = '';
            let commitsDiff = spawn(`cd ${reposDir}/${req.params.repositoryId} && git diff ${parentHash} ${req.params.commitHash}`, {
                shell: true
            });

            commitsDiff.stderr.on('data', data => {
                res.send("STDERR:", data.toString());
            });

            commitsDiff.stdout.on('data', data => {
                data = data.toString();
                result += data;
            });

            commitsDiff.on('close', () => {
                res.json({ data: result });
            });
        })
        .catch(err => res.send(err));
});


// Возвращает содержимое репозитория по названию ветки (или хэшу комита)
app.get('/api/repos/:repositoryId/tree/:commitHash/:path([a-zA-Z0-9\-\/\.]+)*|/api/repos/:repositoryId/tree/:commitHash([a-zA-Z0-9\.|\-|\_]+)*|/api/repos/:repositoryId', (req, res) => {
    let pathToFile = req.params.path ? `${req.params.path}` : ''; // проверка на существование path
    let hash = req.params.commitHash ? `${req.params.commitHash}` : 'master'; // проверка на существование hash

    new Promise((resolve, reject) => {
            exec(`cd ${reposDir}/${req.params.repositoryId} && git checkout ${hash}`, (err, out) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        })
        .then(() => {
            fs.readdir(`${reposDir}/${req.params.repositoryId}/${pathToFile}`, (err, files) => {
                if (err) {
                    res.send(err);
                } else {
                    files = files.filter(file => file !== '.git');
                    files.map((file, i, arr) => {
                        arr[i] = new Promise((resolve, reject) => {
                            fs.stat(path.join(__dirname, reposDir, req.params.repositoryId, pathToFile, file), (err, stats) => {

                                let filesData = {}

                                if (stats.isDirectory()) {
                                    filesData.name = file;
                                    filesData.type = 'folder';
                                    filesData.link = `${pathToFile}/${file}`;
                                } else {
                                    filesData.name = file;
                                    filesData.type = 'file';
                                    filesData.link = `${pathToFile}/${file}`;
                                }
                                resolve(filesData);
                            });
                        });
                    });

                    Promise.all(files)
                        .then(value => {
                            value.sort((a, b) => { return a.type > b.type ? -1 : 1 });
                            res.json({
                                filesList: value,
                                pathToFile: pathToFile,
                                breadcrumbs: [
                                    { name: req.params.repositoryId },
                                    { name: `${reposDir}/${req.params.repositoryId}/${pathToFile}` }
                                ]
                            })
                        });
                }
            });
        })
        .catch(err => res.send(err));
});


// Возвращает содержимое конкретного файла, находящегося по пути pathToFile в ветке (или по хэшу коммита)
app.get('/api/repos/:repositoryId/blob/:commitHash/:pathToFile([a-zA-Z0-9\-\/\.\_]+)*', (req, res) => {

    fs.readFile(`${reposDir}/${req.params.repositoryId}/${req.params.pathToFile}`, 'utf8', (err, data) => {
        res.json({
            fileData: data.split('\n')
        });
    });



    // exec(`cd ${reposDir}/${req.params.repositoryId} && git checkout ${req.params.commitHash}`, (err, out) => {
    //     if (err) {
    //         res.send(err);
    //     }

    //     let file = fs.createReadStream(`${reposDir}/${req.params.repositoryId}/${req.params.pathToFile}`);
    //     file.pipe(res);
    // });
});


// Безвозвратно удаляет репозиторий
app.delete('/api/repos/:repositoryId', (req, res) => {
    rimraf(`${reposDir}/${req.params.repositoryId}`, function() { res.send(`${req.params.repositoryId} deleted`); });
});


// Добавляет репозиторий в список, скачивает его по переданной в теле запроса ссылке и добавляет в папку со всеми репозиториями
app.post('/api/repos', (req, res) => {
    exec(`cd ${reposDir} && git clone ${req.body.url}`, (err, out) => {
        if (err) {
            res.sendStatus(404);
        } else {
            res.send('Repo is downloaded');
        }
    });
});



// BONUS Возвращает заданный через :range массив коммитов в данной ветке (или хэше коммита) вместе с датами их создания и названием
app.get('/api/repos/:repositoryId/commits/:commitHash/pagination/:range', (req, res) => {
    let range = req.params.range.split('-'); // получаем диапазон

    if (range.length === 1) { // если указано одно число, то выдать список длинною в это число
        exec(`cd ${reposDir}/${req.params.repositoryId} && git checkout ${req.params.commitHash} -q && git log -${range[0]} --pretty=tformat:"%H--%s--%ad"`, (err, out) => {
            if (err) {
                res.send(err);
            } else {
                out = out.trim().split('\n').map(el => el.split('--'));
                res.json({ data: out });
            }
        });

    } else {
        new Promise((resolve, reject) => { // получаем список коммитов по первому переданному числу
                exec(`cd ${reposDir}/${req.params.repositoryId} && git checkout ${req.params.commitHash} -q && git log -${range[0]} --pretty=tformat:"%H--%s--%ad"`, (err, out) => {
                    if (err) throw err;
                    out = out.trim().split('\n').map(el => el.split('--'));
                    resolve(out);
                });
            })
            .then(firstList => { // получаем список коммитов по второму переданному числу
                return new Promise((resolve, reject) => {
                    let secondList = [];

                    exec(`cd ${reposDir}/${req.params.repositoryId} && git checkout ${req.params.commitHash} -q && git log -${range[1]} --pretty=tformat:"%H--%s--%ad"`, (err, out) => {
                        if (err) throw err;
                        secondList = out.trim().split('\n').map(el => el.split('--'));
                        resolve({ firstList, secondList });
                    });
                });
            })
            .then(lists => {
                let commitsList = [];
                let lastHashInFirstList = lists.firstList[lists.firstList.length - 1][0];

                // во втором списке ищем номер массива, у которого хеш равен последнему хешу первого списка
                let startPos = lists.secondList.findIndex(el => {
                    return el[0] === lastHashInFirstList;
                });

                // если параметры диапазона больше количества коммитов, то тогда выведется самый последний коммит
                commitsList = lists.secondList.slice(startPos, lists.secondList.length);

                res.json({ data: commitsList });

            })
            .catch(err => res.send(err));
    }
});


// SUPER BONUS HTTP-запрос для подсчета символов в репозитории, возвращает объект, в котором ключ - это символ, а значение - количество таких символов в репозитории
app.get('/api/repos/:repositoryId/symbols', (req, res) => {
    let obj = {};

    new Promise((resolve, reject) => {
        checkRepo(obj, req.params.repositoryId, '') // Заходим в папку
            .then(rs => {
                resolve();
            });
    }).then(result => res.send(obj));

});



function countSymbols(text, objWithSymbs) {
    for (let i = 0; i < text.length; i++) {
        text[i] in objWithSymbs ? objWithSymbs[text[i]]++ : objWithSymbs[text[i]] = 1;
    }
}


function checkRepo(obj, repo, subPath) {
    return new Promise((resolve, reject) => {
            // Читаем имена файлов и папок и записываем имена в объект
            fs.readdir(path.join(__dirname, reposDir, repo, subPath), (err, files) => {
                if (err) {
                    reject(err);
                } else {
                    files.forEach(file => {
                        countSymbols(file, obj);
                    });

                    files = files.filter(el => el !== '.git');
                    resolve(files);
                }
            });
        })
        .then(files => {
            files.map((file, i, arr) => { // делаем из каждого файла промис и закидывем их в Promise.all
                arr[i] = new Promise((resolve, reject) => {
                    fs.stat(path.join(__dirname, reposDir, repo, subPath, file), (err, stats) => {
                        if (stats.isFile()) {
                            // Если это файл, то читаем его содержимое и записываем в объект
                            let readingProcess = fs.createReadStream(path.join(__dirname, reposDir, repo, subPath, file));

                            readingProcess.on('data', chunk => {
                                let data = iconv.encode(chunk, 'utf-8').toString();
                                countSymbols(data, obj);
                            });

                            readingProcess.on('end', () => {
                                resolve('file');
                            });
                        } else {
                            // Если это папка, то рекурсивно вызываем эту же функцию
                            checkRepo(obj, repo, (subPath + '/' + file)).then(rs => {
                                resolve('dir');
                            });
                        }
                    });
                });
            });

            return Promise.all(files);
        })
        .catch(err => {
            obj.err = err;
        });
}