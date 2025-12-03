// test-tools.js
// Script para probar las tools sin necesidad de usar Claude

const { comerciosTools } = require('./tools/comercios-tools');
const { connectMongoDB, closeMongoDB } = require('./tools/mongodb-connection');

async function testTools() {
  console.log('🧪 Iniciando pruebas de tools...\n');

  try {
    // Conectar a MongoDB
    console.log('📡 Conectando a MongoDB...');
    await connectMongoDB();
    console.log('✅ Conectado exitosamente\n');

    // Test 1: Buscar comercio por nombre
    console.log('📝 Test 1: Buscar comercio por nombre "Moment"');
    console.log('─────────────────────────────────────────────');
    const resultado1 = await comerciosTools.handlers.buscar_comercio({
      nombre: 'Moment'
    });
    console.log('Resultados encontrados:', resultado1.length);
    if (resultado1.length > 0) {
      console.log('Primer resultado:', JSON.stringify(resultado1[0], null, 2));
    }
    console.log('\n');

    // Test 2: Listar comercios verificados
    console.log('📝 Test 2: Listar comercios verificados (límite 5)');
    console.log('─────────────────────────────────────────────');
    const resultado2 = await comerciosTools.handlers.comercios_verificados({
      limite: 5
    });
    console.log('Resultados encontrados:', resultado2.length);
    resultado2.forEach((comercio, idx) => {
      console.log(`${idx + 1}. ${comercio.nombre} - ${comercio.direccion}`);
    });
    console.log('\n');

    // Test 3: Buscar por categoría/tag
    console.log('📝 Test 3: Buscar por tag "eventos"');
    console.log('─────────────────────────────────────────────');
    const resultado3 = await comerciosTools.handlers.buscar_por_categoria({
      tag: 'eventos',
      limite: 3
    });
    console.log('Resultados encontrados:', resultado3.length);
    resultado3.forEach((comercio, idx) => {
      console.log(`${idx + 1}. ${comercio.nombre}`);
      console.log(`   Tags: ${comercio.tags.join(', ')}`);
    });
    console.log('\n');

    // Test 4: Obtener detalle completo (usar el ID del primer resultado)
    if (resultado1.length > 0) {
      const comercioId = resultado1[0].id;
      console.log(`📝 Test 4: Obtener detalle completo del comercio ID: ${comercioId}`);
      console.log('─────────────────────────────────────────────');
      const resultado4 = await comerciosTools.handlers.comercio_detalle_completo({
        id: comercioId
      });
      console.log('Nombre:', resultado4.nombre);
      console.log('Contacto:', JSON.stringify(resultado4.contacto, null, 2));
      console.log('Redes sociales:', JSON.stringify(resultado4.redes_sociales, null, 2));
      console.log('\n');

      // Test 5: Obtener solo contacto
      console.log(`📝 Test 5: Obtener contacto del comercio ID: ${comercioId}`);
      console.log('─────────────────────────────────────────────');
      const resultado5 = await comerciosTools.handlers.obtener_contacto_comercio({
        id: comercioId
      });
      console.log(JSON.stringify(resultado5, null, 2));
      console.log('\n');
    }

    // Test 6: Buscar por ubicación
    console.log('📝 Test 6: Buscar por ubicación "San Salvador"');
    console.log('─────────────────────────────────────────────');
    const resultado6 = await comerciosTools.handlers.buscar_por_ubicacion({
      ciudad: 'San Salvador',
      limite: 3
    });
    console.log('Resultados encontrados:', resultado6.length);
    resultado6.forEach((comercio, idx) => {
      console.log(`${idx + 1}. ${comercio.nombre} - ${comercio.direccion}`);
    });
    console.log('\n');

    // Test 7: Listar comercios con filtros
    console.log('📝 Test 7: Listar comercios destacados');
    console.log('─────────────────────────────────────────────');
    const resultado7 = await comerciosTools.handlers.listar_comercios({
      destacado: true,
      limite: 5
    });
    console.log('Resultados encontrados:', resultado7.length);
    resultado7.forEach((comercio, idx) => {
      console.log(`${idx + 1}. ${comercio.nombre} - Vistas: ${comercio.vistas} - ⭐ ${comercio.calificacion}`);
    });
    console.log('\n');

    console.log('✅ Todas las pruebas completadas exitosamente');

  } catch (error) {
    console.error('❌ Error durante las pruebas:', error.message);
    console.error(error);
  } finally {
    // Cerrar conexión
    console.log('\n🔌 Cerrando conexión a MongoDB...');
    await closeMongoDB();
    console.log('✅ Conexión cerrada');
  }
}

// Ejecutar pruebas
testTools();