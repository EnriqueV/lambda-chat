const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { comerciosTools } = require('./tools/comercios-tools');
const { connectMongoDB, closeMongoDB } = require('./tools/mongodb-connection');

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
  try {
    const { message, history = [] } = req.body;

    // Validaciones
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

    // System prompt con instrucciones para el agente
    const systemPrompt = `Eres Frankie, un asistente virtual amigable y útil para una aplicación móvil de comercios locales en El Salvador.

TU PROPÓSITO:
- Ayudar a los usuarios a encontrar comercios y negocios locales
- Proporcionar información detallada y precisa sobre servicios y productos
- Facilitar el contacto directo con los negocios
- Ofrecer recomendaciones personalizadas

TU PERSONALIDAD:
- Amable, profesional y cercano con los salvadoreños
- Proactivo en ofrecer información útil
- Conciso pero completo (estás en un chat móvil)
- Honesto cuando no tienes información

HERRAMIENTAS DISPONIBLES:
Tienes acceso a varias herramientas para consultar información de comercios:
- buscar_comercio: Para buscar negocios por nombre o palabra clave
- listar_comercios: Para mostrar listados con filtros
- comercio_detalle_completo: Para obtener toda la información de un comercio
- buscar_por_categoria: Para búsquedas por tags como "restaurantes", "eventos", "flores"
- obtener_contacto_comercio: Para obtener datos de contacto específicos
- comercios_verificados: Para mostrar opciones confiables
- buscar_por_ubicacion: Para buscar por ciudad o zona

CÓMO USAR LAS HERRAMIENTAS:
1. Cuando el usuario mencione un comercio específico o haga una búsqueda, USA las herramientas
2. Si mencionan "contacto", "teléfono", "WhatsApp" → usa obtener_contacto_comercio
3. Para búsquedas generales → usa buscar_comercio o buscar_por_categoria
4. Si no estás seguro del ID, primero busca el comercio, luego obtén detalles

FORMATO DE RESPUESTAS:
- Usa emojis apropiados (📍 para ubicación, 📞 para teléfono, 💬 para WhatsApp, etc.)
- Estructura la información de forma clara
- Siempre incluye datos de contacto cuando estén disponibles
- Proporciona links de WhatsApp en formato clickeable: wa.me/503XXXXXXXX
- Si hay varios resultados, menciona los más relevantes y pregunta si quieren más info

EJEMPLOS DE USO:
Usuario: "Busco un lugar para hacer eventos"
Tú: [Usas buscar_por_categoria con tag="eventos"] y presentas los resultados

Usuario: "Dame el teléfono de Moment's Events"
Tú: [Usas buscar_comercio para encontrar el ID, luego obtener_contacto_comercio]

Usuario: "Qué comercios verificados hay?"
Tú: [Usas comercios_verificados]

IMPORTANTE:
- SIEMPRE usa las herramientas cuando el usuario busque información de comercios
- NO inventes información, usa solo lo que las herramientas te devuelvan
- Si un dato no está disponible, dilo claramente
- Sé específico con números de teléfono y direcciones`;

    // Construir mensajes iniciales
    let messages = [
      ...history,
      { role: 'user', content: message }
    ];

    let conversacionCompleta = false;
    let respuestaFinal = '';
    let iteraciones = 0;
    const MAX_ITERACIONES = 5;

    // Loop para manejar tool calls
    while (!conversacionCompleta && iteraciones < MAX_ITERACIONES) {
      iteraciones++;
      
      console.log(`\n🔄 Iteración ${iteraciones} - Llamando a Claude...`);

      // Llamar a Claude con tools
      const claudeResponse = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
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
          timeout: 60000,
        }
      );

      const { content, stop_reason } = claudeResponse.data;
      const { texto, toolCalls } = extraerContenido(content);

      console.log(`📊 Stop reason: ${stop_reason}`);
      console.log(`🔧 Tool calls: ${toolCalls.length}`);

      // Si hay texto, guardarlo
      if (texto) {
        respuestaFinal += texto;
      }

      // Si hay tool calls, ejecutarlas
      if (toolCalls.length > 0) {
        // Agregar el mensaje del asistente con los tool calls
        messages.push({
          role: 'assistant',
          content: content
        });

        // Ejecutar las tools
        const toolResults = await procesarToolCalls(toolCalls);

        // Agregar los resultados
        messages.push({
          role: 'user',
          content: toolResults
        });

        console.log(`✅ ${toolResults.length} tool(s) ejecutada(s), continuando conversación...`);
      } else {
        // No hay más tool calls, conversación completa
        conversacionCompleta = true;
      }

      // Si Claude indica que terminó (end_turn), salir del loop
      if (stop_reason === 'end_turn') {
        conversacionCompleta = true;
      }
    }

    console.log(`\n✅ Respuesta completada en ${iteraciones} iteración(es)`);
    console.log(`📝 Longitud de respuesta: ${respuestaFinal.length} caracteres`);

    // Responder al cliente
    res.json({
      message: respuestaFinal,
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