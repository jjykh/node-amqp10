'use strict';
var AMQPClient = require('../../..').Client,
    BrokerAgent = require('qmf2'),

    Session = require('../../../lib/session'),

    c = require('../../../').Constants,

    config = require('./config'),
    expect = require('chai').expect;

var test = {};
describe('QPID', function() {

describe('Disposition', function() {
  beforeEach(function() {
    if (!!test.client) test.client = undefined;
    test.client = new AMQPClient();
  });

  afterEach(function() {
    return test.client.disconnect().then(function() {
      test.client = undefined;
      test.broker = undefined;
    });
  });

  it('should auto-settle messages received from queue', function(done) {
    var queueName = 'test.disposition.queue';
    var messageCount = 0;

    test.client.connect(config.address)
      .then(function() {
        test.broker = new BrokerAgent(test.client);

        return Promise.all([
          test.broker.initialize(),
          test.client.createReceiver(queueName),
          test.client.createSender(queueName)
        ]);
      })
      .spread(function(brokerAgent, receiver, sender) {
        receiver.on('message', function(message) {
          messageCount++;
          if (messageCount !== 2)
            return;

          test.broker.getQueue(queueName)
            .then(function(queue) {
              expect(queue.msgDepth).to.equal(0);
              done();
            });
        });

        return Promise.all([
          sender.send('first message'),
          sender.send('second message')
        ]);
      });
  });

  it('should immediately resolve send promises if `sndSettleMode` is `settled`', function(done) {
    test.client = new AMQPClient({
      senderLink: {
        attach: {
          sndSettleMode: c.senderSettleMode.settled
        }
      }
    });

    test.client.connect(config.address)
      .then(function() { return test.client.createSender('test.disposition.queue'); })
      .then(function(sender) { return sender.send({ llamas: 'are cool' }); })

      // now drain the queue, so we don't leave state on the server
      .then(function() { return test.client.createReceiver('test.disposition.queue'); })
      .then(function(receiver) { receiver.on('message', function(msg) { done(); }); });
  });

  it('should allow for manual disposition of received messages', function(done) {
    var queueName = 'test.disposition.queue';
    var messageCount = 5, receivedCount = 0;

    test.client.connect(config.address)
      .then(function() {
        test.broker = new BrokerAgent(test.client);
        return Promise.all([
          test.broker.initialize(),
          test.client.createReceiver(queueName, {
            attach: {
              rcvSettleMode: c.receiverSettleMode.settleOnDisposition
            },
            creditQuantum: 1
          }),
          test.client.createSender(queueName)
        ]);
      })
      .spread(function(brokerAgent, receiver, sender) {
        receiver.on('message', function(message) {
          receivedCount++;

          // send manual disposition
          this.accept(message);
          if (receivedCount !== messageCount) {
            return;
          }

          test.broker.getQueue(queueName)
            .then(function(queue) {
              expect(queue.msgDepth).to.equal(0);
              done();
            });
        });

        var promises = [];
        for (var i = 0; i < messageCount; i++)
          promises.push(sender.send('message'));
        return Promise.all(promises);
      });
  });

  it('should forward disposition frames by link role', function(done) {
    var queueName = 'test.disposition.queue';
    var called = { receiver: false, sender: false };

    test.client.connect(config.address)
      .then(function() {
        return Promise.all([
          test.client.createReceiver(queueName),
          test.client.createSender(queueName)
        ]);
      })
      .spread(function(receiver, sender) {
        receiver._dispositionReceived = function(d) { called.receiver = true; };
        sender._dispositionReceived = function(d) { called.sender = true; };

        test.client._session.on(Session.DispositionReceived, function(d) {
          expect(called).to.eql({ receiver: false, sender: true });
          done();
        });

        return sender.send('test message')
          .catch(function(err) { /* ignore disposition error */ });
      });
  });

});
});
