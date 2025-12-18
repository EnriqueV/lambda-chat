const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { comerciosTools } = require('./tools/comercios-tools');
const { connectMongoDB, closeMongoDB } = require('./tools/mongodb-connection');
const reviewsService = require('./tools/reviews-service');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURACIÓN ====================
app.use(cors({origin: true}));
app.use(express.json());

// ==================== INICIALIZACIÓN ====================
let mongoConectado = false;

async function inicializarServicio() {
  try {
    await connectMongoDB();
    mongoConectado = true;
    // Crear índices de reviews
    await reviewsService.crearIndices();
    console.log('✅ Servicio inicializado correctamente');
  } catch (error) {
    console.error('❌ Error al inicializar servicio:', error.message);
  }
}

// Inicializar al arrancar
inicializarServicio();

// ==================== FUNCIONES AUXILIARES ====================

/**
 * Procesa las tool calls de Claude y ejecuta las funciones correspondientes
 */
async function procesarToolCalls(toolCalls) {
  const resultados = [];

  for (const toolCall of toolCalls) {
    const { id, name, input } = toolCall;
    
    try {
      console.log(`🔧 Ejecutando tool: ${name}`);
      console.log(`📝 Parámetros:`, JSON.stringify(input, null, 2));
      
      // Ejecutar el handler correspondiente
      const handler = comerciosTools.handlers[name];
      if (!handler) {
        throw new Error(`Handler no encontrado para: ${name}`);
      }
      
      const resultado = await handler(input);
      
      console.log(`✅ Tool ${name} ejecutada exitosamente`);
      
      resultados.push({
        type: 'tool_result',
        tool_use_id: id,
        content: JSON.stringify(resultado, null, 2),
      });
    } catch (error) {
      console.error(`❌ Error ejecutando tool ${name}:`, error.message);
      
      resultados.push({
        type: 'tool_result',
        tool_use_id: id,
        is_error: true,
        content: `Error: ${error.message}`,
      });
    }
  }

  return resultados;
}

/**
 * Extrae texto y tool calls del contenido de Claude
 */
function extraerContenido(content) {
  let texto = '';
  const toolCalls = [];

  for (const block of content) {
    if (block.type === 'text') {
      texto += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push(block);
    }
  }

  return { texto, toolCalls };
}

// ==================== ENDPOINT PRINCIPAL DE CHAT ====================

app.post('/chat', async (req, res) => {

  const systemPrompt = `Eres Frankie, asistente para comercios locales en El Salvador.

  REGLA CRÍTICA - BÚSQUEDAS SIN RESULTADOS:
  Si buscar_comercio o buscar_por_categoria no encuentran nada:
  1. NO repitas la búsqueda con términos similares
  2. INMEDIATAMENTE usa explorar_categorias_disponibles
  3. Con la lista de categorías reales, responde honestamente
  
  FLUJO CORRECTO CUANDO NO HAY RESULTADOS:
  ❌ INCORRECTO:
  - buscar_comercio("mecánica") → []
  - buscar_comercio("taller") → []
  - buscar_comercio("reparación") → []
  - Responder "no encontré nada"
  
  ✅ CORRECTO:
  - buscar_comercio("mecánica") → []
  - explorar_categorias_disponibles() → [lista real de categorías]
  - Responder: "No tengo talleres mecánicos. Las categorías disponibles son: [mostrar top 5-10]. ¿Te interesa alguna?"
  
  HERRAMIENTAS:
  - buscar_comercio: Primera búsqueda
  - explorar_categorias_disponibles: USA ESTO si la búsqueda no encuentra nada
  - compartir_comercio_con_usuario: Al mostrar un comercio específico
  
  FORMATO:
  - Conciso (chat móvil)
  - Emojis: 📍📞💬🏪
  - WhatsApp: wa.me/503XXXXXXXX
  - Honesto cuando no hay resultados
  
  RECUERDA: Si una búsqueda falla → explorar_categorias INMEDIATAMENTE.`;
  try {
    const { message, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'El mensaje es requerido' });
    }

    if (!mongoConectado) {
      return res.status(503).json({ 
        error: 'Servicio no disponible',
        details: 'La conexión a la base de datos no está lista'
      });
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Configuración del servidor incompleta',
        hint: 'Configura CLAUDE_API_KEY en las variables de entorno'
      });
    }

    console.log(`\n💬 Nueva consulta: "${message.substring(0, 80)}..."`);

    let messages = [
      ...history,
      { role: 'user', content: message }
    ];

    let conversacionCompleta = false;
    let respuestaFinal = '';
    let iteraciones = 0;
    const MAX_ITERACIONES = 3; // ✅ Reducido de 5 a 3
    let comercioCompartido = null;
    let busquedasSinResultados = 0;
    const MAX_BUSQUEDAS_FALLIDAS = 4; // ✅ Límite de búsquedas fallidas

    while (!conversacionCompleta && iteraciones < MAX_ITERACIONES) {
      iteraciones++;
      
      console.log(`\n🔄 Iteración ${iteraciones}/${MAX_ITERACIONES}`);

      const claudeResponse = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024, // ✅ Reducido de 2048 a 1024
          system: systemPrompt,
          messages: messages,
          tools: comerciosTools.tools,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          timeout: 30000, // ✅ Reducido de 60s a 30s
        }
      );

      const { content, stop_reason, usage } = claudeResponse.data;
      const { texto, toolCalls } = extraerContenido(content);

      // ✅ Loguear uso de tokens
      if (usage) {
        const costoInput = (usage.input_tokens / 1000000) * 3.00;
        const costoOutput = (usage.output_tokens / 1000000) * 15.00;
        const costoTotal = costoInput + costoOutput;
        console.log(`📊 Tokens - Input: ${usage.input_tokens}, Output: ${usage.output_tokens}`);
        console.log(`💵 Costo aproximado: $${costoTotal.toFixed(6)}`);
      }

      console.log(`📊 Stop reason: ${stop_reason}`);
      console.log(`🔧 Tool calls: ${toolCalls.length}`);
      
      if (texto) {
        respuestaFinal += texto;
      }

      if (toolCalls.length > 0) {
        console.log(`🔍 Tools:`, toolCalls.map(t => t.name).join(', '));
        
        // Capturar comercio compartido
        for (const toolCall of toolCalls) {
          if (toolCall.name === 'compartir_comercio_con_usuario') {
            comercioCompartido = {
              id: toolCall.input.id,
              slug: toolCall.input.slug,
              nombre: toolCall.input.nombre,
            };
            console.log('🏪 Comercio compartido:', comercioCompartido.nombre);
          }
        }
      
        // ✅ MODIFICADO: No contar como búsqueda fallida HASTA ver los resultados
        const esBusqueda = toolCalls.some(t => 
          t.name === 'buscar_comercio' || 
          t.name === 'buscar_por_categoria' ||
          t.name === 'buscar_por_ubicacion'
        );
        
        const usaExplorar = toolCalls.some(t => 
          t.name === 'explorar_categorias_disponibles'
        );
      
        // ✅ NUEVO: Solo incrementar búsquedas fallidas si NO usa explorar
        if (esBusqueda && !usaExplorar) {
          busquedasSinResultados++;
          console.log(`🔍 Búsquedas: ${busquedasSinResultados}/${MAX_BUSQUEDAS_FALLIDAS}`);
        }
        
        // ✅ MODIFICADO: Reset si usa explorar
        if (usaExplorar) {
          console.log('✅ Usando explorar_categorias, reseteando contador');
          busquedasSinResultados = 0;
        }
      
        messages.push({
          role: 'assistant',
          content: content
        });
      
        // ✅ EJECUTAR TOOLS PRIMERO
        const toolResults = await procesarToolCalls(toolCalls);
      
        messages.push({
          role: 'user',
          content: toolResults
        });
      
        console.log(`✅ ${toolResults.length} tool(s) ejecutadas`);
        
        // ✅ NUEVO: Solo forzar fin si DESPUÉS de ejecutar las tools sigue sin resultados
        // Y NO usó explorar_categorias
        if (busquedasSinResultados >= MAX_BUSQUEDAS_FALLIDAS && !usaExplorar) {
          console.log(`⚠️ ${MAX_BUSQUEDAS_FALLIDAS} búsquedas sin usar explorar, permitiendo una iteración más para que Claude use explorar_categorias`);
          // NO forzar aquí, dar una iteración más
        }
        
      } else {
        conversacionCompleta = true;
      }

      if (stop_reason === 'end_turn') {
        conversacionCompleta = true;
      }
    }

    // ✅ Advertencia si alcanzó límite
    if (iteraciones >= MAX_ITERACIONES && !conversacionCompleta) {
      console.log(`⚠️ Límite de iteraciones alcanzado`);
    }

    console.log(`\n✅ Completado en ${iteraciones} iteración(es)`);
    console.log(`📝 Respuesta: ${respuestaFinal.length} caracteres`);

    res.json({
      message: respuestaFinal,
      itemSlug: comercioCompartido?.slug || null,
      itemId: comercioCompartido?.id || null,
      itemNombre: comercioCompartido?.nombre || null,
      metadata: {
        iteraciones: iteraciones,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error en /chat:', error.message);
    
    if (error.response) {
      console.error('📄 Respuesta de error:', error.response.data);
      return res.status(error.response.status).json({
        error: 'Error al comunicarse con Claude',
        details: error.response.data?.error?.message || 'Error desconocido',
        type: error.response.data?.error?.type
      });
    }
    
    res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message,
    });
  }
});
// ==================== ENDPOINTS AUXILIARES ====================

/**
 * Endpoint de prueba directo de tools (sin Claude)
 */
app.post('/test-tool', async (req, res) => {
  try {
    const { toolName, params } = req.body;
    
    if (!toolName) {
      return res.status(400).json({ error: 'toolName es requerido' });
    }

    const handler = comerciosTools.handlers[toolName];
    if (!handler) {
      return res.status(404).json({ error: `Tool '${toolName}' no encontrada` });
    }

    const resultado = await handler(params || {});
    
    res.json({
      tool: toolName,
      resultado: resultado,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error en /test-tool:', error);
    res.status(500).json({ 
      error: 'Error al ejecutar tool',
      details: error.message 
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  const claudeKeyConfigured = !!process.env.CLAUDE_API_KEY;
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Claude Chat API con Tools - Frankie',
    version: '3.0.0',
    configuracion: {
      claudeAPI: claudeKeyConfigured ? '✅ Configurada' : '❌ No configurada',
      mongodb: mongoConectado ? '✅ Conectado' : '❌ Desconectado',
      puerto: PORT,
      entorno: process.env.NODE_ENV || 'development'
    },
    tools_disponibles: comerciosTools.tools.map(t => ({
      nombre: t.name,
      descripcion: t.description
    }))
  });
});

/**
 * Crear una nueva review
 */
app.post('/reviews', async (req, res) => {
  try {
    const { item_id, reviewer_name, reviewer_email, rating, review_text } = req.body;

    if (!mongoConectado) {
      return res.status(503).json({ 
        error: 'Servicio no disponible',
        details: 'La conexión a la base de datos no está lista'
      });
    }

    // Verificar si el usuario ya dejó una review para este item
    const yaReviso = await reviewsService.usuarioYaRevisoItem(item_id, reviewer_email);
    if (yaReviso) {
      return res.status(409).json({
        error: 'Ya existe una review de este usuario para este item',
        suggestion: 'El usuario ya dejó una reseña para este producto/servicio'
      });
    }

    // Crear la review (las validaciones están en el servicio)
    const resultado = await reviewsService.crearReview({
      item_id,
      reviewer_name,
      reviewer_email,
      rating,
      review_text
    });

    console.log(`✅ Review creada para item ${item_id}`);

    res.status(201).json(resultado);

  } catch (error) {
    console.error('❌ Error en POST /reviews:', error.message);
    
    // Si es error de validación, retornar 400
    if (error.message.includes('Errores de validación')) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: error.message
      });
    }
    
    res.status(500).json({
      error: 'Error al crear review',
      details: error.message
    });
  }
});

/**
 * Obtener todas las reviews de un item
 */
app.get('/reviews/:item_id', async (req, res) => {
  try {
    const { item_id } = req.params;

    if (!item_id) {
      return res.status(400).json({
        error: 'item_id es requerido en la URL'
      });
    }

    if (!mongoConectado) {
      return res.status(503).json({ 
        error: 'Servicio no disponible',
        details: 'La conexión a la base de datos no está lista'
      });
    }

    const resultado = await reviewsService.obtenerReviewsPorItem(item_id);

    console.log(`✅ Reviews obtenidas para item ${item_id}: ${resultado.total_reviews} encontradas`);

    res.json(resultado);

  } catch (error) {
    console.error('❌ Error en GET /reviews/:item_id:', error.message);
    res.status(500).json({
      error: 'Error al obtener reviews',
      details: error.message
    });
  }
});

/**
 * Listar tools disponibles
 */
app.get('/tools', (req, res) => {
  res.json({
    total: comerciosTools.tools.length,
    tools: comerciosTools.tools
  });
});

/**
 * Root endpoint
 */
app.get('/', (req, res) => {
  res.json({
    servicio: 'Claude Chat API - Frankie Assistant con Tools',
    version: '3.0.0',
    descripcion: 'API de chat con herramientas inteligentes para consultar comercios',
    endpoints: {
      chat: {
        metodo: 'POST',
        ruta: '/chat',
        descripcion: 'Envía un mensaje al asistente virtual',
        body: { message: 'string', history: 'array (opcional)' }
      },
      testTool: {
        metodo: 'POST',
        ruta: '/test-tool',
        descripcion: 'Prueba una tool directamente sin Claude',
        body: { toolName: 'string', params: 'object' }
      },
      tools: {
        metodo: 'GET',
        ruta: '/tools',
        descripcion: 'Lista todas las tools disponibles'
      },
      health: {
        metodo: 'GET',
        ruta: '/health',
        descripcion: 'Verifica el estado del servicio'
      }
    },
    ejemplos: {
      chat: {
        url: '/chat',
        body: {
          message: 'Busco un lugar para hacer eventos',
          history: []
        }
      },
      testTool: {
        url: '/test-tool',
        body: {
          toolName: 'buscar_comercio',
          params: { nombre: 'Moment' }
        }
      }
    },
    documentacion: 'https://docs.anthropic.com'
  });
});

// ==================== MANEJO DE ERRORES ====================

app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint no encontrado',
    ruta: req.path,
    metodo: req.method,
    ayuda: 'Visita / para ver los endpoints disponibles'
  });
});

app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err);
  res.status(500).json({
    error: 'Error interno del servidor',
    mensaje: err.message
  });
});

// ==================== INICIAR SERVIDOR ====================

app.listen(PORT, () => {
  console.log('\n🚀 ================================');
  console.log('   Claude Chat API - Frankie v3.0');
  console.log('   ================================');
  console.log(`   Puerto: ${PORT}`);
  console.log(`   MongoDB: ${mongoConectado ? '✅' : '⏳ Conectando...'}`);
  console.log(`   Claude API: ${process.env.CLAUDE_API_KEY ? '✅' : '❌'}`);
  console.log(`   Tools: ${comerciosTools.tools.length} disponibles`);
  console.log('   ================================');
  console.log(`   💬 Chat: POST http://localhost:${PORT}/chat`);
  console.log(`   🔧 Test Tool: POST http://localhost:${PORT}/test-tool`);
  console.log(`   📋 Tools: GET http://localhost:${PORT}/tools`);
  console.log(`   🏥 Health: GET http://localhost:${PORT}/health`);
  console.log('   ================================\n');
});

// ==================== MANEJO DE SEÑALES ====================

process.on('SIGTERM', async () => {
  console.log('⚠️  SIGTERM recibido, cerrando servidor...');
  await closeMongoDB();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⚠️  SIGINT recibido, cerrando servidor...');
  await closeMongoDB();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});