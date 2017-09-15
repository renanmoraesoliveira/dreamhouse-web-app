var path = require('path');
var express = require('express');
var bodyParser = require('body-parser');
var pg = require('pg');
var Kafka = require('no-kafka');

var app = express();

app.use(express.static('www'));
app.use(express.static(path.join('www', 'build')));

app.use(bodyParser.json());

//var brokerUrls = process.env.KAFKA_URL.replace(/\+ssl/g,'');
var kafkaPrefix = process.env.KAFKA_PREFIX;
if (kafkaPrefix === undefined) {
  kafkaPrefix = '';
}

var producer = new Kafka.Producer();

producer.init();

var connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/dreamhouse';

if (process.env.DATABASE_URL !== undefined) {
  pg.defaults.ssl = true;
}

var client = new pg.Client(connectionString);
client.connect();

var propertyTable = 'property__c';
var favoriteTable = 'favorite__c';
var brokerTable = 'broker__c';
var user__c = null;

function lookupUser() {
  client.query('SELECT user__c FROM ' + favoriteTable + ' GROUP BY user__c', function(error, data) {
    console.log(error, data);
    user__c = data.rows[Math.floor(Math.random() * data.rows.length)].user__c;
  });
}

// setup the demo data if needed
client.query('SELECT * FROM salesforce.broker__c', function(error, data) {
  if (error !== null) {
    client.query('SELECT * FROM broker__c', function(error, data) {
      if (error !== null) {
        console.log('Loading Demo Data...');
        require('./db/demo.js')(client);
        console.log('Done Loading Demo Data!');

        lookupUser();
      }
    });
  }
  else {
    var schema = 'salesforce.';
    propertyTable = schema + 'property__c';
    favoriteTable = schema + 'favorite__c';
    brokerTable = schema + 'broker__c';

    lookupUser();
  }
});

function sendInteraction(propertyId, eventType) {
  var data = {
    userId: user__c,
    propertyId: propertyId,
    eventType: eventType,
    date: Date.now()
  };

  producer.send({
    topic: kafkaPrefix + 'interactions',
    message: {
      value: JSON.stringify(data)
    }
  });
}


app.get('/property', function(req, res) {
  client.query('SELECT * FROM ' + propertyTable, function(error, data) {
    res.json(data.rows);
  });
});

app.get('/property/:id', function(req, res) {
  sendInteraction(req.params.id, "view");
  client.query('SELECT ' + propertyTable + '.*, ' + brokerTable + '.sfid AS broker__c_sfid, ' + brokerTable + '.name AS broker__c_name, ' + brokerTable + '.email__c AS broker__c_email__c, ' + brokerTable + '.phone__c AS broker__c_phone__c, ' + brokerTable + '.mobile_phone__c AS broker__c_mobile_phone__c, ' + brokerTable + '.title__c AS broker__c_title__c, ' + brokerTable + '.picture__c AS broker__c_picture__c FROM ' + propertyTable + ' INNER JOIN ' + brokerTable + ' ON ' + propertyTable + '.broker__c = ' + brokerTable + '.sfid WHERE ' + propertyTable + '.sfid = $1', [req.params.id], function(error, data) {
    res.json(data.rows[0]);
  });
});


app.get('/favorite', function(req, res) {
  client.query('SELECT ' + propertyTable + '.*, ' + favoriteTable + '.sfid AS favorite__c_sfid FROM ' + propertyTable + ', ' + favoriteTable + ' WHERE ' + propertyTable + '.sfid = ' + favoriteTable + '.property__c', function(error, data) {
    res.json(data.rows);
  });
});

app.post('/favorite', function(req, res) {
  sendInteraction(req.body.property__c, "favorite");
  client.query('INSERT INTO ' + favoriteTable + ' (property__c) VALUES ($1)', [req.body.property__c], function(error, data) {
    res.json(data);
  });
});

app.delete('/favorite/:sfid', function(req, res) {
  client.query('DELETE FROM ' + favoriteTable + ' WHERE sfid = $1', [req.params.sfid], function(error, data) {
    res.json(data);
  });
});


app.get('/broker', function(req, res) {
  client.query('SELECT * FROM ' + brokerTable, function(error, data) {
    res.json(data.rows);
  });
});

app.get('/broker/:sfid', function(req, res) {
  client.query('SELECT * FROM ' + brokerTable + ' WHERE sfid = $1', [req.params.sfid], function(error, data) {
    res.json(data.rows[0]);
  });
});

var port = process.env.PORT || 8200;

app.listen(port);

console.log('Listening at: http://localhost:' + port);
