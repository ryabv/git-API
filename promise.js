(function(){
	if (typeof global !== 'undefined') {
		if (!global.Promise) {
			global.Prom = Prom;
		}
	} else if (typeof window !== 'undefined') {
		if (!window.Promise) {
			window.Prom = Prom;		
		}
	}

	// global.Prom = Prom;

	function Prom(callback) {
		var PENDING = 0;
		var FULFILLED = 1;
		var REJECTED = 2;
		var state = PENDING;
		var value = null;
		var queue = [];

		function fulfill(result) {
			state = FULFILLED;
			value = result;
			queue.forEach(handle);
			queue = [];
		}

		function reject(error) {
			state = REJECTED;
			value = error;
			queue.forEach(handle);
			queue = [];
		}

		function resolve(result) {
			try {
				var then = getThen(result);
				if (then) {
					doResolve(then.bind(result), resolve, reject);
					return;
				}
				fulfill(result);
			} catch(e) {
				reject(e);
			}
		}

		// получает then промиса
		function getThen(value) {
			var t = typeof value;
			if (value && (t === 'object' || t === 'function')) {
				var then = value.then;
				if (typeof then === 'function') {
					return then;
				}
			}
			return null;
		}

		// исполняет промис
		function doResolve(fn, onFulfilled, onRejected) {
			var done = false;
			try {
				fn(function (value) {
					if (done) {	return;	}
					done = true;
					onFulfilled(value);
				}, function (reason) {
					if (done) {	return;	}
					done = true;
					onRejected(reason);
				})
			} catch (ex) {
				if (done) {	return;	}
				done = true;
				onRejected(ex);
			}
		}

		function handle(handler) {
			if (state === PENDING) {
				// добавляет полученный объект с onFulfilled и onRejected в очередь
				queue.push(handler);
			} else {
				if (state === FULFILLED && typeof handler.onFulfilled === 'function') {
					// исполняет onFulfilled переданного объекта
					handler.onFulfilled(value);
				}
				if (state === REJECTED && typeof handler.onRejected === 'function') {
					// исполняет onRejected переданного объекта
					handler.onRejected(value);
				}
			}
		}

		// асинхронно запускает функцию добавления onFulfilled и onRejected в очередь
		this.addToQueue = function(onFulfilled, onRejected) {
			setTimeout(function() {
				handle({
					onFulfilled: onFulfilled,
					onRejected: onRejected
				});
			}, 0);
		}

		// получает инструкции из then и возвращает промис с ними
		this.then = function(onFulfilled, onRejected) {
			var self = this;
			return new Prom(function(resolve, reject) {
				return self.addToQueue(function(result) {
					if (typeof onFulfilled === 'function') {
						try {
							return resolve(onFulfilled(result));
						} catch (ex) {
							return reject(onRejected(ex));
						}
					} else {
						return resolve(result);
					}
				}, function(error) {
					if (typeof onRejected === 'function') {
						try {
							return reject(onRejected(error));
						} catch (ex) {
							return reject(ex);
						}
					} else {
						return reject(error);
					}
				});
			});
		}

		doResolve(callback, resolve, reject);
	}
})();






var promise = new Prom(function (resolve) {
	setTimeout(function() {
    	resolve(42);	
	}, 1000);
	
})

promise
    .then(function (value) {
        return value + 1
    })
    .then(function (value) {
        console.log(value) // 43
        return new Prom(function (resolve) { resolve(137) })
    })
    .then(function (value) {
        console.log(value) // 137
        throw new Error()
    })
    .then(
        function () { console.log('Будет проигнорировано') },
        function () { return 'ошибка обработана' }
    )
    .then(function (value) {
        console.log(value) // "ошибка обработана"
    })