// tools/reviews-service.js
const { getCollection } = require('./mongodb-connection');
const { ObjectId } = require('mongodb');

/**
 * Servicio para manejar operaciones de reviews usando MongoDB driver nativo
 */
class ReviewsService {
  
  constructor() {
    this.collectionName = 'reviews';
  }

  /**
   * Obtener la colección de reviews
   */
  async getReviewsCollection() {
    return await getCollection(this.collectionName);
  }

  /**
   * Validar datos de review
   */
  validarDatosReview(datos) {
    const errores = [];

    if (!datos.item_id || typeof datos.item_id !== 'string') {
      errores.push('item_id es requerido y debe ser un string');
    }

    if (!datos.reviewer_email || typeof datos.reviewer_email !== 'string') {
      errores.push('reviewer_email es requerido');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.reviewer_email)) {
      errores.push('reviewer_email no tiene un formato válido');
    }

    if (datos.rating === undefined || datos.rating === null) {
      errores.push('rating es requerido');
    } else {
      const rating = parseInt(datos.rating);
      if (isNaN(rating) || rating < 1 || rating > 5) {
        errores.push('rating debe ser un número entre 1 y 5');
      }
    }

    if (!datos.review_text || typeof datos.review_text !== 'string') {
      errores.push('review_text es requerido');
    } else if (datos.review_text.trim().length === 0) {
      errores.push('review_text no puede estar vacío');
    }

    return errores;
  }

  /**
   * Crear una nueva review
   */
  async crearReview(datosReview) {
    try {
      // Validación
      const errores = this.validarDatosReview(datosReview);
      if (errores.length > 0) {
        throw new Error(`Errores de validación: ${errores.join(', ')}`);
      }

      const collection = await this.getReviewsCollection();

      // Preparar documento
      const documento = {
        item_id: datosReview.item_id,
        reviewer_name: datosReview.reviewer_name || 'Usuario Renval',
        reviewer_email: datosReview.reviewer_email.toLowerCase().trim(),
        rating: parseInt(datosReview.rating),
        review_text: datosReview.review_text.trim(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Insertar en MongoDB
      const resultado = await collection.insertOne(documento);
      
      console.log(`✅ Review creada con ID: ${resultado.insertedId} para item: ${documento.item_id}`);
      
      return {
        success: true,
        message: 'Review creada exitosamente',
        review: {
          id: resultado.insertedId,
          item_id: documento.item_id,
          reviewer_name: documento.reviewer_name,
          rating: documento.rating,
          review_text: documento.review_text,
          createdAt: documento.createdAt
        }
      };
      
    } catch (error) {
      console.error('❌ Error al crear review:', error.message);
      throw error;
    }
  }

  /**
   * Obtener todas las reviews de un item específico
   */
  async obtenerReviewsPorItem(itemId) {
    try {
      if (!itemId) {
        throw new Error('item_id es requerido');
      }

      const collection = await this.getReviewsCollection();

      // Buscar reviews del item
      const reviews = await collection
        .find({ item_id: itemId })
        .sort({ createdAt: -1 }) // Más recientes primero
        .toArray();

      // Calcular estadísticas
      const totalReviews = reviews.length;
      const promedioRating = totalReviews > 0 
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
        : 0;

      // Distribución de ratings
      const distribucion = {
        5: reviews.filter(r => r.rating === 5).length,
        4: reviews.filter(r => r.rating === 4).length,
        3: reviews.filter(r => r.rating === 3).length,
        2: reviews.filter(r => r.rating === 2).length,
        1: reviews.filter(r => r.rating === 1).length,
      };

      console.log(`✅ ${totalReviews} reviews encontradas para item: ${itemId}`);

      return {
        success: true,
        item_id: itemId,
        total_reviews: totalReviews,
        promedio_rating: parseFloat(promedioRating.toFixed(2)),
        distribucion_ratings: distribucion,
        reviews: reviews.map(r => ({
          id: r._id,
          reviewer_name: r.reviewer_name,
          reviewer_email: r.reviewer_email,
          rating: r.rating,
          review_text: r.review_text,
          fecha: r.createdAt
        }))
      };
      
    } catch (error) {
      console.error('❌ Error al obtener reviews:', error.message);
      throw error;
    }
  }

  /**
   * Obtener estadísticas generales de reviews de un item
   */
  async obtenerEstadisticasItem(itemId) {
    try {
      const resultado = await this.obtenerReviewsPorItem(itemId);
      
      return {
        success: true,
        item_id: itemId,
        total_reviews: resultado.total_reviews,
        promedio_rating: resultado.promedio_rating,
        distribucion_ratings: resultado.distribucion_ratings
      };
      
    } catch (error) {
      console.error('❌ Error al obtener estadísticas:', error.message);
      throw error;
    }
  }

  /**
   * Validar si un usuario ya dejó review para un item
   */
  async usuarioYaRevisoItem(itemId, email) {
    try {
      const collection = await this.getReviewsCollection();
      
      const reviewExistente = await collection.findOne({
        item_id: itemId,
        reviewer_email: email.toLowerCase().trim()
      });

      return !!reviewExistente;
      
    } catch (error) {
      console.error('❌ Error al validar review existente:', error.message);
      throw error;
    }
  }

  /**
   * Crear índices en la colección (llamar una vez al iniciar)
   */
  async crearIndices() {
    try {
      const collection = await this.getReviewsCollection();
      
      // Índice para item_id (búsquedas frecuentes)
      await collection.createIndex({ item_id: 1 });
      
      // Índice compuesto para item_id + fecha
      await collection.createIndex({ item_id: 1, createdAt: -1 });
      
      // Índice para email (validar duplicados)
      await collection.createIndex({ reviewer_email: 1 });
      
      // Índice para rating (estadísticas)
      await collection.createIndex({ rating: 1 });
      
      console.log('✅ Índices de reviews creados exitosamente');
      
    } catch (error) {
      console.error('⚠️ Error al crear índices:', error.message);
      // No lanzar error, los índices son optimización
    }
  }
}

// Exportar una instancia única del servicio
module.exports = new ReviewsService();