"use strict";
let swarm = require('swarm-protocol');
let sync = require('swarm-syncable');
let OpStream = sync.OpStream;

/** An OpStream on top of a Node.js stream.
 *  Maintains batching guarantees: sends data asynchronously, terminates
 *  a bundle with \n\n. Expects incoming bundles to be \n\n terminated. */
class NodeOpStream extends OpStream {

    /** @param stream - Node.js stream */
    constructor (stream) {
        super();
        this._stream = stream;
        stream.setEncoding('utf8');
        this._chunks = [];
        this._ops = [];
        this._send_to = null;
        this._on_data_cb = this._on_data.bind(this);
        this._on_end_cb = this._on_end.bind(this);
        this._send_cb = this._send.bind(this);
    }

    _start () {
        this._stream.on('data', this._on_data_cb);
        this._stream.on('end', this._on_end_cb);
    }

    _on_data (chunk) {
        const chunks = this._chunks;
        const had_nl = chunks.length && /\n$/m.test(chunks[chunks.length-1]);
        const at = chunk.indexOf('\n\n');
        if (had_nl&&chunk[0]==='\n') {
            this._on_batch();
            this._on_data(chunk.substr(1));
        } else if (at!==-1) {
            chunks.push(chunk.substr(0, at+2))
            this._on_batch();
            if (at+2<chunk.length)
                this._on_data(chunk.substr(at+2));
        } else {
            chunks.push(chunk);
        }
    }

    _on_batch () {
        let ops = swarm.Op.parseFrame(this._chunks.join(''));
        if (ops===null) {
            this.offer();
            this._close();
        } else {
            this._emitAll(ops);
        }
        this._chunks.length = 0;
    }

    offer (op) {
        this._ops.push(op.toString());
        if (this._send_to===null)
            this._send_to = setTimeout(this._send_cb, 1);
    }

    _send () {
        if (this._stream===null)
            return; // closed concurrently
        this._send_to = null;
        this._ops.push(''); // batch terminator
        this._stream.write(this._ops.join('\n'));
        this._ops.length = 0;
    }

    _on_end () {
        if (this._stream===null)
            return; // closed
        this._send();
        this.close();
    }

    close () {
        this._stream.removeListener('data', this._on_data_cb);
        this._stream.removeListener('end', this._on_end_cb);
        this._stream.end();
        this._stream = null;
        super._end();
    }

}

module.exports = NodeOpStream;