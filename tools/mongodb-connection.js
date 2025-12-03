// tools/mongodb-connection.js
const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://doadmin:P91i8723gJB6Qf4q@db-mongodb-nyc3-42209-a8beedae.mongo.ondigitalocean.com/renval?tls=true&authSource=admin&replicaSet=db-mongodb-nyc3-42209';

let client;
let db;

async function connectMongoDB() {
  if (db) {
    return db;
  }

  try {
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    await client.connect();
    db = client.db('renval');
    
    console.log('✅ Conectado a MongoDB exitosamente');
    return db;
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    throw error;
  }
}

async function getCollection(collectionName) {
  const database = await connectMongoDB();
  return database.collection(collectionName);
}

async function closeMongoDB() {
  if (client) {
    await client.close();
    console.log('🔌 Conexión a MongoDB cerrada');
  }
}

module.exports = {
  connectMongoDB,
  getCollection,
  closeMongoDB,
};