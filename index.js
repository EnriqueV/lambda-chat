const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS para permitir requests desde tu app Ionic
app.use(cors({origin: true}));
app.use(express.json());

// Endpoint principal de chat
app.post('/chat', async (req, res) => {
  try {
    const {message, history} = req.body;

    if (!message) {
      return res.status(400).json({error: 'Mensaje es requerido'});
    }

    const apiKey = process.env.CLAUDE_API_KEY;

    if (!apiKey) {
      console.error('⚠️  CLAUDE_API_KEY no configurada');
      return res.status(500).json({
        error: 'Configuración del servidor incompleta',
      });
    }

    // Construir historial de mensajes
    const messages = [
      ...(history || []),
      {role: 'user', content: message},
    ];

    console.log(`📨 Mensaje recibido: "${message}"`);

    // Llamar a Claude API
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: `Eres Frankie, un asistente virtual amigable y útil para una aplicación móvil. 

Tu propósito es ayudar a los usuarios con:
- Información sobre comercios y negocios locales
- Realizar cotizaciones de productos y servicios
- Responder preguntas generales de manera clara y concisa

Características de tu personalidad:
- Eres amable, profesional y cercano
- Das respuestas claras y breves (ideal para chat móvil)
- Si no tienes información específica sobre un comercio, lo indicas honestamente
- Ofreces ayuda proactiva cuando es apropiado

Recuerda: Estás en un chat móvil, así que mantén tus respuestas concisas y fáciles de leer.`,
        messages: messages,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      },
    );

    const assistantMessage = response.data.content[0].text;

    console.log(`✅ Respuesta enviada (${assistantMessage.length} chars)`);

    res.json({
      message: assistantMessage,
      conversationId: response.data.id,
    });
  } catch (error) {
    console.error('❌ Error al llamar a Claude:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Error al procesar el mensaje',
      details: error.response?.data?.error?.message || error.message,
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'claude-chat-api',
    environment: process.env.NODE_ENV || 'development',
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Claude Chat API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      chat: 'POST /chat',
    },
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Claude Chat API corriendo en puerto ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`💬 Chat endpoint: http://localhost:${PORT}/chat`);
});

// Manejo de errores no capturados
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});