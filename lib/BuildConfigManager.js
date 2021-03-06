const _ = require('lodash');
const { fork } = require('child_process');
const path = require('path');
const fsModule = require('fs');

class BuildConfigManager {
    constructor({ workDir = process.cwd(), fs = fsModule } = {}) {
        this.CONFIG_FILE_NAME = 'stencil.conf.js';

        this._workDir = workDir;
        this._buildConfigPath = path.join(workDir, this.CONFIG_FILE_NAME);
        this._fs = fs;
        this._onReadyCallbacks = [];
        this._worker = null;
        this._workerIsReady = false;

        const config = this._getConfig(this._buildConfigPath);

        this.development = config.development || this._devWorker;
        this.production = config.production || this._prodWorker;
        this.watchOptions = config.watchOptions;
    }

    initWorker() {
        if (this._fs.existsSync(this._buildConfigPath)) {
            this._worker = fork(this._buildConfigPath, [], { cwd: this._workDir });

            this._worker.on('message', (message) => {
                if (message === 'ready') {
                    this._workerIsReady = true;
                    this._onReadyCallbacks.forEach((callback) => callback());
                }
            });
        }

        return this;
    }

    stopWorker(signal = 'SIGTERM') {
        this._worker.kill(signal);
    }

    _getConfig(configPath) {
        if (this._fs.existsSync(configPath)) {
            // eslint-disable-next-line
            return require(configPath);
        }

        return {};
    }

    _onWorkerReady(onReady) {
        if (this._workerIsReady) {
            process.nextTick(onReady);
        }

        this._onReadyCallbacks.push(onReady);
    }

    _devWorker(browserSync) {
        if (!this._worker) {
            return;
        }
        // send a message to the worker to start watching
        // and wait for message to reload the browser
        this._worker.send('development');
        this._worker.on('message', (message) => {
            if (message === 'reload') {
                browserSync.reload();
            }
        });
    }

    _prodWorker(done) {
        const callback = _.once(done);

        if (!this._worker) {
            process.nextTick(() => callback('worker initialization failed'));
            return;
        }

        const timeout = setTimeout(() => {
            this.stopWorker();
            callback('worker timed out');
        }, 20000);

        this._onWorkerReady(() => {
            clearTimeout(timeout);
            // send a message to the worker to start bundling js
            this._worker.send('production');
            this._worker.on('message', (message) => {
                if (message === 'done') {
                    this._worker.kill();
                    callback();
                }
            });
        });

        this._worker.on('close', () => callback('worker terminated'));
    }
}

module.exports = BuildConfigManager;
