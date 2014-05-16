var fs     = require('fs');
var util   = require('util');
var EventEmitter = require('events').EventEmitter;
var async = require('async');

// Constants
var PATH = '/sys/class/gpio';

// Constructor
function Gpio() {
    EventEmitter.call(this);
    this.reset();
}
util.inherits(Gpio, EventEmitter);

var pins = {
    current: undefined,
    v1: {
        '1':  null,
        '2':  null,
        '3':  0,
        '4':  null,
        '5':  1,
        '6':  null,
        '7':  4,
        '8':  14,
        '9':  null,
        '10': 15,
        '11': 17,
        '12': 18,
        '13': 21,
        '14': null,
        '15': 22,
        '16': 23,
        '17': null,
        '18': 24,
        '19': 10,
        '20': null,
        '21': 9,
        '22': 25,
        '23': 11,
        '24': 8,
        '25': null,
        '26': 7
    },
    v2: {
        '1':  null,
        '2':  null,
        '3':  2,
        '4':  null,
        '5':  3,
        '6':  null,
        '7':  4,
        '8':  14,
        '9':  null,
        '10': 15,
        '11': 17,
        '12': 18,
        '13': 27,
        '14': null,
        '15': 22,
        '16': 23,
        '17': null,
        '18': 24,
        '19': 10,
        '20': null,
        '21': 9,
        '22': 25,
        '23': 11,
        '24': 8,
        '25': null,
        '26': 7
    }
};

// Constants
Gpio.prototype.DIR_IN   = 'in';
Gpio.prototype.DIR_OUT  = 'out';
Gpio.prototype.MODE_RPI = 'mode_rpi';
Gpio.prototype.MODE_BCM = 'mode_bcm';

/**
 * Set pin reference mode. Defaults to 'rpi'.
 *
 * @param {string} mode Pin reference mode, 'rpi' or 'bcm'
 */
Gpio.prototype.setMode = function(mode) {
    if (mode === this.MODE_RPI) {
        getPinForCurrentMode = getPinRpi;
    } else if (mode === this.MODE_BCM) {
        getPinForCurrentMode = getPinBcm;
    } else {
        throw new Error('Cannot set invalid mode');
    }

    this.emit('modeChange', mode);
};

/**
 * Setup a channel for use as an input or output
 *
 * @param {number}   channel   Reference to the pin in the current mode's schema
 * @param {string}   direction The pin direction, either 'in' or 'out'
 * @param {function} cb        Optional callback
 */
Gpio.prototype.setup = function(channel, direction, cb /*err*/) {
    if (!channel) {
        return cb(new Error('Channel not specified'));
    }

    direction = direction || this.DIR_OUT;

    if (typeof direction === 'function') {
        cb = direction;
        direction = this.DIR_OUT;
    }

    if (direction !== this.DIR_IN && direction !== this.DIR_OUT) {
        return cb(new Error('Cannot set invalid direction'));
    }

    var self = this;
    var pin;

    async.waterfall([
        function(next) {
            setRaspberryVersion(next);
        },
        function(next) {
            pin = getPinForCurrentMode(channel);
            isExported(pin, next);
        },
        function(isExported, next) {
            if (isExported) {
                return unexportPin(pin, next);
            }
            return next(null);
        },
        function(next) {
            exportPin(pin, next);
        },
        function(next) {
            self.exportedPins[pin] = true;
            self.emit('export', channel);
            setListener(pin, function() {
                self.read(channel, function(err, value) {
                    if (err) return cb(err);
                    self.emit('change', channel, value);
                });
            });
            setDirection(pin, direction, next);
        }
    ], cb);
};

/**
 * Write a value to a channel
 *
 * @param {number}   channel The channel to write to
 * @param {boolean}  value   If true, turns the channel on, else turns off
 * @param {function} cb      Optional callback
 */
Gpio.prototype.write = function(channel, value, cb /*err*/ ) {
    var pin = getPinForCurrentMode(channel);

    if (!this.exportedPins[pin]) {
        return cb(new Error('Pin has not been exported'));
    }

    value = (!!value && value !== '0') ? '1' : '0';
    fs.writeFile(PATH + '/gpio' + pin + '/value', value, function(err) {
        if (cb) return cb(err);
    }.bind(this));
};
Gpio.prototype.output = Gpio.prototype.write;

/**
 * Read a value from a channel
 *
 * @param {number}   channel The channel to read from
 * @param {function} cb      Callback which receives the channel's boolean value
 */
Gpio.prototype.read = function(channel, cb /*err,value*/) {
    var pin = getPinForCurrentMode(channel);

    if (!this.exportedPins[pin]) {
        return cb(new Error('Pin has not been exported'));
    }

    fs.readFile(PATH + '/gpio' + pin + '/value', 'utf-8', function(err, data) {
        data = (data + '').trim() || '0';
        return cb(err, (data === '1' ? true : false));
    });
};
Gpio.prototype.input = Gpio.prototype.read;

/**
 * Unexport any open pins
 *
 * @param {function} cb Optional callback
 */
Gpio.prototype.destroy = function(cb) {
    var pins = Object.keys(this.exportedPins);
    var pinCount = pins.length;
    while (pinCount--) {
        var pin = pins[pinCount];
        if (pinCount === 0 && cb) {
            unexportPin(pin, cb);
        } else {
            unexportPin(pin);
        }
    }
};

/**
 * Reset the state of the module
 */
Gpio.prototype.reset = function() {
    this.exportedPins = {};
    this.removeAllListeners();

    pins.current = undefined;
    getPinForCurrentMode = getPinRpi;
};

/**
 * Sets the version of the model
 */
function setRaspberryVersion(cb) {
    if (pins.current) {
        return cb(null);
    }

    fs.readFile('/proc/cpuinfo', 'utf8', function(err, data) {
        if (err) return cb(err);

        // Match the last 4 digits of the number following "Revision:"
        var match = data.match(/Revision\s*:\s*\d*(\d{4})/);
        var revisionNumber = match[1];

        if (revisionNumber === '0002' || revisionNumber === '0003') {
            pins.current = pins.v1;
        } else {
            pins.current = pins.v2;
        }

        return cb(null);
    });
};

var getPinForCurrentMode = getPinRpi;
function getPinRpi(channel) {
    return pins.current[channel] + '';
};

function getPinBcm(channel) {
    return channel + '';
};


function setDirection(pin, direction, cb) {
    fs.writeFile(PATH + '/gpio' + pin + '/direction', direction, function(err) {
        if (cb) return cb(err);
    });
}

function exportPin(pin, cb) {
    fs.writeFile(PATH + '/export', pin, function(err) {
        if (cb) return cb(err);
    });
}

function unexportPin(pin, cb) {
    fs.unwatchFile(PATH + '/gpio' + pin + '/value');
    fs.writeFile(PATH + '/unexport', pin, function(err) {
        if (cb) return cb(err);
    });
}

function isExported(pin, cb) {
    fs.exists(PATH + '/gpio' + pin, function(exists) {
        return cb(null, exists);
    });
}

function setListener(pin, cb) {
    fs.watchFile(PATH + '/gpio' + pin + '/value', cb);
}

module.exports = new Gpio;
