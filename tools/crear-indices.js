// tools/crear-indices.js
const { connectMongoDB, getCollection, closeMongoDB } = require('./mongodb-connection');

async function crearIndices() {
  try {
    await connectMongoDB();
    const collection = await getCollection('Item');

    console.log('📊 Creando índices para mejorar búsquedas...\n');

    // 1. Índice de texto completo (MUY IMPORTANTE para búsquedas)
    await collection.createIndex(
      { 
        name: 'text', 
        description: 'text', 
        tags: 'text',
        address: 'text'
      },
      { 
        name: 'busqueda_texto_completo',
        weights: {
          name: 10,      // Nombre más importante
          tags: 5,       // Tags también importantes
          description: 2, // Descripción menos peso
          address: 1     // Dirección menor peso
        }
      }
    );
    console.log('✅ Índice de texto completo creado');

    // 2. Índice compuesto para status + verify
    await collection.createIndex(
      { status: 1, verify: 1 },
      { name: 'status_verify' }
    );
    console.log('✅ Índice status + verify creado');

    // 3. Índice para tags (búsquedas por categoría)
    await collection.createIndex(
      { tags: 1 },
      { name: 'tags_index' }
    );
    console.log('✅ Índice de tags creado');

    // 4. Índice para slug (búsqueda directa)
    await collection.createIndex(
      { slug: 1 },
      { name: 'slug_index', unique: true }
    );
    console.log('✅ Índice de slug creado');

    // 5. Índice para ordenar por vistas
    await collection.createIndex(
      { views: -1 },
      { name: 'views_index' }
    );
    console.log('✅ Índice de vistas creado');

    // 6. Índice geoespacial (si usas lat/lng)
    await collection.createIndex(
      { location: '2dsphere' }, // Necesitas un campo location: { type: 'Point', coordinates: [lng, lat] }
      { name: 'location_index' }
    );
    console.log('✅ Índice geoespacial creado');

    // Ver todos los índices
    const indices = await collection.indexes();
    console.log('\n📋 Índices existentes:');
    indices.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    await closeMongoDB();
    console.log('\n✅ Índices creados exitosamente');
  } catch (error) {
    console.error('❌ Error creando índices:', error);
  }
}

crearIndices();