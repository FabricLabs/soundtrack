'use strict';

const assert = require('assert');
const Queue = require('../functions/queue');

function entry (id, requestedAt, votes = {}, duration = 100) {
  return { id, track: { id: `t-${id}`, duration }, curator: { id: `u-${id}`, name: id }, requestedAt, votes };
}

describe('queue', function () {
  it('plays the highest score first, then the oldest request', function () {
    let queue = Queue.emptyQueue();
    queue = Queue.enqueue(queue, entry('a', 1));
    queue = Queue.enqueue(queue, entry('b', 2));
    queue = Queue.enqueue(queue, entry('c', 3));
    assert.deepStrictEqual(queue.entries.map((item) => item.id), ['a', 'b', 'c']);
    queue = Queue.vote(queue, 'c', 'x', 1);
    queue = Queue.vote(queue, 'a', 'x', -1);
    assert.deepStrictEqual(queue.entries.map((item) => item.id), ['c', 'b', 'a']);
  });

  it('counts each voter once, takes the latest vote, and clears with 0', function () {
    let queue = Queue.enqueue(Queue.emptyQueue(), entry('a', 1));
    queue = Queue.vote(queue, 'a', 'x', 1);
    queue = Queue.vote(queue, 'a', 'x', 1);
    queue = Queue.vote(queue, 'a', 'y', 1);
    assert.strictEqual(Queue.score(queue.entries[0]), 2);
    queue = Queue.vote(queue, 'a', 'x', -1);
    assert.strictEqual(Queue.score(queue.entries[0]), 0);
    queue = Queue.vote(queue, 'a', 'x', 0);
    assert.deepStrictEqual(queue.entries[0].votes, { y: 1 });
    assert.throws(() => Queue.vote(queue, 'a', 'x', 2), /1, -1, or 0/);
    assert.throws(() => Queue.vote(queue, 'zz', 'x', 1), /not in the queue/);
  });

  it('leaves its input alone', function () {
    const before = Queue.enqueue(Queue.emptyQueue(), entry('a', 1));
    const frozen = JSON.stringify(before);
    Queue.vote(before, 'a', 'x', 1);
    Queue.advance(before, 5);
    Queue.remove(before, 'a');
    assert.strictEqual(JSON.stringify(before), frozen);
  });

  it('advances, tracks position, and knows when the track ends', function () {
    let queue = Queue.enqueue(Queue.enqueue(Queue.emptyQueue(), entry('a', 1, {}, 60)), entry('b', 2));
    assert.strictEqual(Queue.position(queue, 10), null);
    queue = Queue.advance(queue, 1000);
    assert.strictEqual(queue.current.entry.id, 'a');
    assert.strictEqual(queue.current.startedAt, 1000);
    assert.strictEqual(Queue.position(queue, 31000), 30);
    assert.strictEqual(Queue.endsAt(queue), 61000);
    queue = Queue.advance(Queue.advance(queue, 61000), 70000);
    assert.strictEqual(queue.current, null);
    assert.strictEqual(Queue.endsAt(queue), null);
  });
});
