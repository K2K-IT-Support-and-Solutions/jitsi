import React, { Component, useRef, useEffect, useState } from 'react';
import { connect } from 'react-redux';
import VideoLayout from '../../../../modules/UI/videolayout/VideoLayout';
import { IReduxState, IStore } from '../../app/types';
import { isDisplayNameVisible } from '../../base/config/functions.web';
import { VIDEO_TYPE } from '../../base/media/constants';
import { getLocalParticipant } from '../../base/participants/functions';
import Watermarks from '../../base/react/components/web/Watermarks';
import { getHideSelfView } from '../../base/settings/functions.any';
import { getVideoTrackByParticipant } from '../../base/tracks/functions.web';
import { setColorAlpha } from '../../base/util/helpers';
import StageParticipantNameLabel from '../../display-name/components/web/StageParticipantNameLabel';
import { FILMSTRIP_BREAKPOINT } from '../../filmstrip/constants';
import { getVerticalViewMaxWidth, isFilmstripResizable } from '../../filmstrip/functions.web';
import SharedVideo from '../../shared-video/components/web/SharedVideo';
import Captions from '../../subtitles/components/web/Captions';
import { setTileView } from '../../video-layout/actions.web';
import Whiteboard from '../../whiteboard/components/web/Whiteboard';
import { isWhiteboardEnabled } from '../../whiteboard/functions';
import { setSeeWhatIsBeingShared } from '../actions.web';
import { getLargeVideoParticipant } from '../functions';
import ScreenSharePlaceholder from './ScreenSharePlaceholder.web';

// Global type declarations for CDN-loaded libraries
declare global {
    interface Window {
        tf: any;
        facemesh: any;
    }
}

const styles = {
    largeVideoContainer: {
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden'
    },
    videoWrapper: {
        position: 'relative',
        width: '100%',
        height: '100%',
        zIndex: 1
    },
    videoElement: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        zIndex: 1
    },
    faceMaskCanvas: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '200%',
        height: '200%',
        pointerEvents: 'none',
        zIndex: 2
    },
    debugOverlay: {
        position: 'absolute',
        top: 10,
        left: 10,
        backgroundColor: 'rgba(0,0,0,0.7)',
        color: 'white',
        padding: '5px',
        fontSize: '12px',
        zIndex: 3
    }
};

interface FaceMaskOverlayProps {
    videoElement: HTMLVideoElement | null;
    debugMode?: boolean;
}

const FaceMaskOverlay: React.FC<FaceMaskOverlayProps> = ({ videoElement, debugMode = false }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const modelRef = useRef<any>(null);
    const animationFrameRef = useRef<number | null>(null);
    const [currentFilter, setCurrentFilter] = useState<number>(0);
    const imagesLoaded = useRef<boolean>(false);
    const filterImages = useRef<{
        glasses: HTMLImageElement | null;
        mustache: HTMLImageElement | null;
        catEars: HTMLImageElement | null;
    }>({ glasses: null, mustache: null, catEars: null });

    // Load filter images
    useEffect(() => {
        const loadImages = async () => {
            try {
                const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
                    const img = new Image();
                    img.src = src;
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                });

                filterImages.current = {
                    glasses: await loadImage('https://i.ibb.co/Nd4KFPhQ/Black-glasses.png'),
                    mustache: await loadImage('https://www.pngitem.com/pimgs/m/509-5099664_overlay-cute-cat-filter-cat-ears-transparent-png.png'),
                    catEars: await loadImage('https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRHIMKQEt8Eg2zhR9P8aonez-_RztCa5PFPbg&s')
                };
                imagesLoaded.current = true;
            } catch (error) {
                console.error('Failed to load filter images:', error);
            }
        };

        loadImages();
    }, []);

    useEffect(() => {
        const filterInterval = setInterval(() => {
            setCurrentFilter(prev => (prev + 1) % 3);
        }, 5000);
        return () => clearInterval(filterInterval);
    }, []);

    const applyGlassesFilter = (ctx: CanvasRenderingContext2D, prediction: any) => {
        const glassesImg = filterImages.current.glasses;
        if (!glassesImg) return;
    
        const leftEye = prediction.annotations.leftEyeUpper0;
        const rightEye = prediction.annotations.rightEyeUpper0;
        if (!leftEye || !rightEye) return;
    
        const leftCenter = leftEye[Math.floor(leftEye.length / 2)];
        const rightCenter = rightEye[Math.floor(rightEye.length / 2)];
    
        const centerX = (leftCenter[0] + rightCenter[0]) / 2;
        const centerY = (leftCenter[1] + rightCenter[1]) / 2;
    
        const dx = rightCenter[0] - leftCenter[0];
        const dy = rightCenter[1] - leftCenter[1];
        const angle = Math.atan2(dy, dx);
    
        const glassesWidth = Math.hypot(dx, dy) * 2.2;
        const glassesHeight = glassesWidth / 2.5;
    
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(angle);
        ctx.scale(1, -1)
        ctx.drawImage(
            glassesImg,
            -glassesWidth / 2,
            -glassesHeight / 2,
            glassesWidth,
            glassesHeight
        );
        ctx.restore();
    };

    const applyMustacheFilter = (ctx: CanvasRenderingContext2D, prediction: any) => {
        const mustacheImg = filterImages.current.mustache;
        if (!mustacheImg) return;

        const noseBottom = prediction.annotations.noseBottom?.[0];
        const upperLip = prediction.annotations.upperLip?.[0];
        if (!noseBottom || !upperLip) return;

        const mustacheWidth = Math.abs(upperLip[0] - noseBottom[0]) * 2;
        const mustacheHeight = mustacheWidth * (mustacheImg.naturalHeight / mustacheImg.naturalWidth);

        ctx.drawImage(
            mustacheImg,
            noseBottom[0] - mustacheWidth/2,
            noseBottom[1] - mustacheHeight * 0.5,
            mustacheWidth * 1.3,
            mustacheHeight * 1.2
        );
    };

    const applyCatEarsFilter = (ctx: CanvasRenderingContext2D, prediction: any) => {
        const catEarsImg = filterImages.current.catEars;
        if (!catEarsImg) return;

        const leftEyebrow = prediction.annotations.leftEyebrow?.[0];
        const rightEyebrow = prediction.annotations.rightEyebrow?.[0];
        if (!leftEyebrow || !rightEyebrow) return;

        const earsWidth = rightEyebrow[0] - leftEyebrow[0];
        const earsHeight = earsWidth * (catEarsImg.naturalHeight / catEarsImg.naturalWidth);

        ctx.drawImage(
            catEarsImg,
            leftEyebrow[0] - earsWidth * 0.4,
            leftEyebrow[1] - earsHeight * 1.5,
            earsWidth * 0.8,
            earsHeight * 1.3
        );

        ctx.drawImage(
            catEarsImg,
            rightEyebrow[0] - earsWidth * 0.4,
            rightEyebrow[1] - earsHeight * 1.5,
            earsWidth * 0.8,
            earsHeight * 1.3
        );
    };

    const drawMasks = (predictions: any[]) => {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx || !canvasRef.current || !imagesLoaded.current) return;

        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        if (predictions.length === 0) return;

        const isMirrored = videoElement?.style.transform.includes('scaleX(-1)');

        if (isMirrored) {
            ctx.scale(-1, 1);
            ctx.translate(-canvasRef.current.width, 0);
        }

        predictions.forEach(prediction => {
            try {
                switch(currentFilter) {
                    case 0: 
                        applyGlassesFilter(ctx, prediction);
                        break;
                    case 1:
                        applyMustacheFilter(ctx, prediction);
                        break;
                    case 2:
                        applyCatEarsFilter(ctx, prediction);
                        break;
                }
            } catch (error) {
                console.error('Error applying filter:', error);
            }
        });

        if (debugMode && predictions.length > 0) {
            const firstFace = predictions[0];
           
        }
        if (isMirrored) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
    };

    const loadScript = (src: string) => {
        return new Promise<void>((resolve, reject) => {
            const existingScript = document.querySelector(`script[src="${src}"]`);
            if (existingScript) {
                existingScript.addEventListener('load', () => resolve());
                existingScript.addEventListener('error', reject);
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve();
            script.onerror = reject;
            document.head.appendChild(script);
        });
    };

    const loadDependencies = async () => {
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest');
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/facemesh@latest');
    };

    const predict = async () => {
        if (!modelRef.current || !videoElement || !canvasRef.current || videoElement.readyState < 2) {
            return;
        }

        try {
            const containerWidth = videoElement.offsetWidth;
            const containerHeight = videoElement.offsetHeight;
            if (canvasRef.current.width !== containerWidth || canvasRef.current.height !== containerHeight) {
                canvasRef.current.width = containerWidth;
                canvasRef.current.height = containerHeight;
            }

            const predictions = await modelRef.current.estimateFaces(videoElement);
            const videoWidth = videoElement.videoWidth;
            const videoHeight = videoElement.videoHeight;
            const videoAspect = videoWidth / videoHeight;
            const containerAspect = containerWidth / containerHeight;

            let scale, offsetX, offsetY;
            if (containerAspect > videoAspect) {
                scale = containerHeight / videoHeight;
                const scaledWidth = videoWidth * scale;
                offsetX = (containerWidth - scaledWidth) / 2;
                offsetY = 0;
            } else {
                scale = containerWidth / videoWidth;
                const scaledHeight = videoHeight * scale;
                offsetY = (containerHeight - scaledHeight) / 2;
                offsetX = 0;
            }

            const scaledPredictions = predictions.map((prediction: any) => {
                const scaledAnnotations: { [key: string]: number[][] } = {};
                Object.entries(prediction.annotations).forEach(([key, points]: [string, any]) => {
                    scaledAnnotations[key] = points.map(([x, y]: [number, number]) => [
                        x * scale + offsetX, 
                        y * scale + offsetY
                    ]);
                });
                return { ...prediction, annotations: scaledAnnotations };
            });

            drawMasks(scaledPredictions);
        } catch (error) {
            console.error('Face detection error:', error);
        }

        animationFrameRef.current = requestAnimationFrame(predict);
    };

    const loadModel = async () => {
        try {
            await loadDependencies();
            await window.tf.ready();
            modelRef.current = await window.facemesh.load({
                maxFaces: 1,
                inputResolution: { width: 320, height: 240 },
                detectionConfidence: 0.7
            });
            predict();
        } catch (error) {
            console.error('Model loading failed:', error);
        }
    };

    useEffect(() => {
        if (videoElement) {
            if (videoElement.readyState >= 2) {
                loadModel();
            } else {
                const handleCanPlay = () => loadModel();
                videoElement.addEventListener('canplay', handleCanPlay);
                return () => videoElement.removeEventListener('canplay', handleCanPlay);
            }
        }

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (modelRef.current) {
                modelRef.current.dispose();
            }
        };
    }, [videoElement]);

    return (
        <canvas 
            ref={canvasRef}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 2
            }}
        />
    );
};

const SPOT_DISPLAY_NAME = 'Meeting Room';

interface IProps {
    _backgroundAlpha?: number;
    _customBackgroundColor: string;
    _customBackgroundImageUrl: string;
    _displayScreenSharingPlaceholder: boolean;
    _hideSelfView: boolean;
    _isChatOpen: boolean;
    _isDisplayNameVisible: boolean;
    _isScreenSharing: boolean;
    _largeVideoParticipantId: string;
    _localParticipantId: string;
    _noAutoPlayVideo: boolean;
    _resizableFilmstrip: boolean;
    _seeWhatIsBeingShared: boolean;
    _showDominantSpeakerBadge: boolean;
    _verticalFilmstripWidth?: number | null;
    _verticalViewMaxWidth: number;
    _visibleFilmstrip: boolean;
    _whiteboardEnabled: boolean;
    dispatch: IStore['dispatch'];
}

class LargeVideo extends Component<IProps> {
    _tappedTimeout: number | undefined;
    _containerRef: React.RefObject<HTMLDivElement>;
    _wrapperRef: React.RefObject<HTMLDivElement>;
    _videoRef: React.RefObject<HTMLVideoElement>;

    constructor(props: IProps) {
        super(props);
        this._containerRef = React.createRef<HTMLDivElement>();
        this._wrapperRef = React.createRef<HTMLDivElement>();
        this._videoRef = React.createRef<HTMLVideoElement>();

        this._clearTapTimeout = this._clearTapTimeout.bind(this);
        this._onDoubleTap = this._onDoubleTap.bind(this);
        this._updateLayout = this._updateLayout.bind(this);
    }

    override componentDidUpdate(prevProps: IProps) {
        const {
            _visibleFilmstrip,
            _isScreenSharing,
            _seeWhatIsBeingShared,
            _largeVideoParticipantId,
            _hideSelfView,
            _localParticipantId } = this.props;

        if (prevProps._visibleFilmstrip !== _visibleFilmstrip) {
            this._updateLayout();
        }

        if (prevProps._isScreenSharing !== _isScreenSharing && !_isScreenSharing) {
            this.props.dispatch(setSeeWhatIsBeingShared(false));
        }

        if (_isScreenSharing && _seeWhatIsBeingShared) {
            VideoLayout.updateLargeVideo(_largeVideoParticipantId, true, true);
        }

        if (_largeVideoParticipantId === _localParticipantId
            && prevProps._hideSelfView !== _hideSelfView) {
            VideoLayout.updateLargeVideo(_largeVideoParticipantId, true, false);
        }
    }

    override render() {
        const {
            _displayScreenSharingPlaceholder,
            _isChatOpen,
            _isDisplayNameVisible,
            _noAutoPlayVideo,
            _showDominantSpeakerBadge,
            _whiteboardEnabled
        } = this.props;
        const style = this._getCustomStyles();
        const className = `videocontainer${_isChatOpen ? ' shift-right' : ''}`;

        return (
            <div
                className={className}
                id="largeVideoContainer"
                ref={this._containerRef}
                style={style}>
                <SharedVideo />
                {_whiteboardEnabled && <Whiteboard />}
                <div id="etherpad" />

                <Watermarks />

                <div
                    id="dominantSpeaker"
                    onTouchEnd={this._onDoubleTap}>
                    <div className="dynamic-shadow" />
                    <div id="dominantSpeakerAvatarContainer" />
                </div>
                <div id="remotePresenceMessage" />
                <span id="remoteConnectionMessage" />
                <div id="largeVideoElementsContainer">
                    <div id="largeVideoBackgroundContainer" />
                    {_displayScreenSharingPlaceholder ? <ScreenSharePlaceholder /> : <></>}
                    <div
                        id="largeVideoWrapper"
                        onTouchEnd={this._onDoubleTap}
                        ref={this._wrapperRef}
                        role="figure">
                        <video
                            ref={this._videoRef}
                            autoPlay={!_noAutoPlayVideo}
                            id="largeVideo"
                            muted={true}
                            playsInline={true} />
                       {this._videoRef.current && <FaceMaskOverlay videoElement={this._videoRef.current} debugMode={true} />}
                    </div>
                </div>
                {interfaceConfig.DISABLE_TRANSCRIPTION_SUBTITLES || <Captions />}
                {_isDisplayNameVisible && _showDominantSpeakerBadge && <StageParticipantNameLabel />}
            </div>
        );
    }

    _updateLayout() {
        const { _verticalFilmstripWidth, _resizableFilmstrip } = this.props;

        if (_resizableFilmstrip && Number(_verticalFilmstripWidth) >= FILMSTRIP_BREAKPOINT) {
            this._containerRef.current?.classList.add('transition');
            this._wrapperRef.current?.classList.add('transition');
            VideoLayout.refreshLayout();

            setTimeout(() => {
                this._containerRef?.current?.classList.remove('transition');
                this._wrapperRef?.current?.classList.remove('transition');
            }, 1000);
        } else {
            VideoLayout.refreshLayout();
        }
    }

    _clearTapTimeout() {
        clearTimeout(this._tappedTimeout);
        this._tappedTimeout = undefined;
    }

    _getCustomStyles() {
        const styles: any = {};
        const {
            _customBackgroundColor,
            _customBackgroundImageUrl,
            _verticalFilmstripWidth,
            _verticalViewMaxWidth,
            _visibleFilmstrip
        } = this.props;

        styles.backgroundColor = _customBackgroundColor || interfaceConfig.DEFAULT_BACKGROUND;

        if (this.props._backgroundAlpha !== undefined) {
            const alphaColor = setColorAlpha(styles.backgroundColor, this.props._backgroundAlpha);
            styles.backgroundColor = alphaColor;
        }

        if (_customBackgroundImageUrl) {
            styles.backgroundImage = `url(${_customBackgroundImageUrl})`;
            styles.backgroundSize = 'cover';
        }

        if (_visibleFilmstrip && Number(_verticalFilmstripWidth) >= FILMSTRIP_BREAKPOINT) {
            styles.width = `calc(100% - ${_verticalViewMaxWidth || 0}px)`;
        }

        return styles;
    }

    _onDoubleTap(e: React.TouchEvent) {
        e.stopPropagation();
        e.preventDefault();

        if (this._tappedTimeout) {
            this._clearTapTimeout();
            this.props.dispatch(setTileView(true));
        } else {
            this._tappedTimeout = window.setTimeout(this._clearTapTimeout, 300);
        }
    }
}

function _mapStateToProps(state: IReduxState) {
    const testingConfig = state['features/base/config'].testing;
    const { backgroundColor, backgroundImageUrl } = state['features/dynamic-branding'];
    const { isOpen: isChatOpen } = state['features/chat'];
    const { width: verticalFilmstripWidth, visible } = state['features/filmstrip'];
    const { defaultLocalDisplayName, hideDominantSpeakerBadge } = state['features/base/config'];
    const { seeWhatIsBeingShared } = state['features/large-video'];
    const localParticipantId = getLocalParticipant(state)?.id;
    const largeVideoParticipant = getLargeVideoParticipant(state);
    const videoTrack = getVideoTrackByParticipant(state, largeVideoParticipant);
    const isLocalScreenshareOnLargeVideo = largeVideoParticipant?.id?.includes(localParticipantId ?? '')
        && videoTrack?.videoType === VIDEO_TYPE.DESKTOP;
    const isOnSpot = defaultLocalDisplayName === SPOT_DISPLAY_NAME;

    return {
        _backgroundAlpha: state['features/base/config'].backgroundAlpha,
        _customBackgroundColor: backgroundColor,
        _customBackgroundImageUrl: backgroundImageUrl,
        _displayScreenSharingPlaceholder: Boolean(isLocalScreenshareOnLargeVideo && !seeWhatIsBeingShared && !isOnSpot),
        _hideSelfView: getHideSelfView(state),
        _isChatOpen: isChatOpen,
        _isDisplayNameVisible: isDisplayNameVisible(state),
        _isScreenSharing: Boolean(isLocalScreenshareOnLargeVideo),
        _largeVideoParticipantId: largeVideoParticipant?.id ?? '',
        _localParticipantId: localParticipantId ?? '',
        _noAutoPlayVideo: Boolean(testingConfig?.noAutoPlayVideo),
        _resizableFilmstrip: isFilmstripResizable(state),
        _seeWhatIsBeingShared: Boolean(seeWhatIsBeingShared),
        _showDominantSpeakerBadge: !hideDominantSpeakerBadge,
        _verticalFilmstripWidth: verticalFilmstripWidth.current,
        _verticalViewMaxWidth: getVerticalViewMaxWidth(state),
        _visibleFilmstrip: visible,
        _whiteboardEnabled: isWhiteboardEnabled(state)
    };
}

export default connect(_mapStateToProps)(LargeVideo);